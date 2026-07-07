import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { testAwareLimiter } from '../route-utils';
import { optionalAuth, requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import {
  gameNightInvites,
  gameNightOptions,
  gameNightRsvps,
  gameNights,
  gameNightSeries,
  type GameNightRow,
} from '../db/schema';
import { areFriends } from '../friends/relations';
import { ORIGIN, SITE_NAME, type ShareLandingMeta } from '../shares/og';

/**
 * Game nights (E123): propose a date to play, invite friends, or hand anyone
 * a link — RSVPs work without an account. A night is a *scheduling* artifact,
 * deliberately separate from `game_sessions` (the live authed game state).
 *
 * Token contract mirrors shares: unguessable, unknown tokens 404 (stealthy),
 * but a *cancelled* night stays readable so a guest holding the link sees
 * "cancelled" instead of a dead page.
 */
export const gameNightsRouter: Router = Router();

const publicLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
// Writes from unauthenticated holders of a leaked link — keep tighter than reads.
const rsvpLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

const TITLE_MAX = 80;
const LOCATION_MAX = 120;
const NOTES_MAX = 500;
const NAME_MAX = 40;
const MAX_INVITES = 32;
/** Abuse bound on a public link; no real table fits more people than this. */
const MAX_RSVPS = 64;
const MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
/** A night stays listed/RSVP-able until a day after it starts. */
const GRACE_MS = 24 * 60 * 60 * 1000;
/** Date-poll bounds (E124): the host proposes 2–5 slots; suggestions cap the total. */
const MIN_OPTIONS = 2;
const MAX_HOST_OPTIONS = 5;
const MAX_OPTIONS = 8;

type RsvpStatus = 'going' | 'maybe' | 'declined';

function isRsvpStatus(x: unknown): x is RsvpStatus {
  return x === 'going' || x === 'maybe' || x === 'declined';
}

function newToken(): string {
  // Same shape as share tokens: 24 bytes → 32 url-safe chars, unguessable.
  return crypto.randomBytes(24).toString('base64url');
}

/** Trimmed string within [1, max] length, else null. */
function cleanRequired(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/** Trimmed optional string: undefined = absent, null = invalid, '' → null value. */
function cleanOptional(x: unknown, max: number): string | null | undefined {
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (typeof x !== 'string' || x.trim().length > max) return undefined as never;
  const s = x.trim();
  return s.length === 0 ? null : s;
}

function isValidStartsAt(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x < Date.now() + MAX_FUTURE_MS;
}

/** IANA timezone name Intl accepts (e.g. 'America/Chicago'); anything else is dropped. */
function cleanTimezone(x: unknown): string | null {
  if (typeof x !== 'string' || x.length === 0 || x.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: x });
    return x;
  } catch {
    return null;
  }
}

interface RsvpView {
  displayName: string;
  status: RsvpStatus;
  isHost: boolean;
}

/** A poll option as sent to clients — voter display names only, never rsvp ids. */
interface OptionView {
  id: string;
  startsAt: number;
  /** Display name of the attendee who suggested it; null = host-created slot. */
  proposedBy: string | null;
  voters: string[];
  myVote: boolean;
}

/** A poll option with voter identities, for per-viewer projection. */
interface LoadedOption {
  id: string;
  startsAt: number;
  proposedBy: string | null;
  voters: Array<{ rsvpId: string; userId: string | null; displayName: string }>;
}

/** Options + votes for a set of nights, keyed by night id, slots soonest-first. */
async function loadNightOptions(nightIds: string[]): Promise<Map<string, LoadedOption[]>> {
  const byNight = new Map<string, LoadedOption[]>();
  if (nightIds.length === 0) return byNight;
  const rows = await getPool().query<{
    id: string;
    night_id: string;
    starts_at: string;
    proposed_by: string | null;
    rsvp_id: string | null;
    user_id: string | null;
    display_name: string | null;
  }>(
    `SELECT o.id, o.night_id, o.starts_at, o.proposed_by,
            v.rsvp_id, r.user_id, r.display_name
       FROM game_night_options o
       LEFT JOIN game_night_votes v ON v.option_id = o.id
       LEFT JOIN game_night_rsvps r ON r.id = v.rsvp_id
      WHERE o.night_id = ANY($1)
      ORDER BY o.starts_at ASC, o.created_at ASC, v.created_at ASC`,
    [nightIds]
  );
  const byOption = new Map<string, LoadedOption>();
  for (const r of rows.rows) {
    let option = byOption.get(r.id);
    if (!option) {
      option = {
        id: r.id,
        startsAt: Number(r.starts_at),
        proposedBy: r.proposed_by,
        voters: [],
      };
      byOption.set(r.id, option);
      const arr = byNight.get(r.night_id) ?? [];
      arr.push(option);
      byNight.set(r.night_id, arr);
    }
    if (r.rsvp_id !== null) {
      option.voters.push({
        rsvpId: r.rsvp_id,
        userId: r.user_id,
        displayName: r.display_name ?? '',
      });
    }
  }
  return byNight;
}

function toOptionViews(
  options: LoadedOption[],
  isMine: (v: { rsvpId: string; userId: string | null }) => boolean
): OptionView[] {
  return options.map((o) => ({
    id: o.id,
    startsAt: o.startsAt,
    proposedBy: o.proposedBy,
    voters: o.voters.map((v) => v.displayName),
    myVote: o.voters.some(isMine),
  }));
}

/**
 * The voter identity for poll writes is an rsvp row, so the guest credential
 * story matches RSVPs exactly: authed voters get their user row (created as
 * 'maybe' if they haven't replied — voting never overwrites a status they
 * already gave); guests present their stored rsvpId, with stale/unknown ids
 * falling through to create-with-displayName like the RSVP flow.
 */
async function resolveVoterRsvp(
  night: GameNightRow,
  user: { id: string; username: string } | undefined,
  body: Record<string, unknown>
): Promise<{ rsvp: { id: string; displayName: string } } | { error: string; status: number }> {
  const pool = getPool();
  const now = Date.now();
  if (user) {
    const upsert = await pool.query<{ id: string; display_name: string }>(
      `INSERT INTO game_night_rsvps (id, night_id, user_id, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'maybe', $5, $5)
       ON CONFLICT (night_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET updated_at = $5
       RETURNING id, display_name`,
      [crypto.randomUUID(), night.id, user.id, user.username, now]
    );
    const r = upsert.rows[0];
    return { rsvp: { id: r.id, displayName: r.display_name } };
  }
  if (typeof body.rsvpId === 'string' && body.rsvpId.length > 0) {
    const found = await pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM game_night_rsvps
        WHERE id = $1 AND night_id = $2 AND user_id IS NULL`,
      [body.rsvpId, night.id]
    );
    if (found.rows.length > 0) {
      const r = found.rows[0];
      return { rsvp: { id: r.id, displayName: r.display_name } };
    }
  }
  const displayName = cleanRequired(body.displayName, NAME_MAX);
  if (!displayName) {
    return { error: `displayName is required (max ${NAME_MAX} characters).`, status: 400 };
  }
  const count = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM game_night_rsvps WHERE night_id = $1`,
    [night.id]
  );
  if (Number(count.rows[0].n) >= MAX_RSVPS) {
    return { error: 'This game night is full.', status: 400 };
  }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO game_night_rsvps (id, night_id, user_id, display_name, status, created_at, updated_at)
     VALUES ($1, $2, NULL, $3, 'maybe', $4, $4)`,
    [id, night.id, displayName, now]
  );
  return { rsvp: { id, displayName } };
}

/** Why poll/RSVP writes are refused, or null if the night is still open. */
function nightClosedError(night: GameNightRow): string | null {
  if (night.cancelledAt !== null) return 'This game night was cancelled.';
  if (night.startsAt < Date.now() - GRACE_MS) return 'This game night has already happened.';
  return null;
}

/** Validated 2–5 distinct candidate slots for a date poll, or an error string. */
function cleanOptionSlots(raw: unknown): number[] | string {
  if (!Array.isArray(raw) || raw.some((x) => !isValidStartsAt(x))) {
    return 'options must be an array of epoch-ms timestamps.';
  }
  const slots = raw as number[];
  if (new Set(slots).size !== slots.length) {
    return 'options must be distinct times.';
  }
  if (slots.length < MIN_OPTIONS || slots.length > MAX_HOST_OPTIONS) {
    return `Give ${MIN_OPTIONS}–${MAX_HOST_OPTIONS} candidate times to vote on.`;
  }
  return slots;
}

/** Recurring-series details attached to an occurrence's view (E125). */
interface SeriesInfo {
  id: string;
  token: string;
  endedAt: number | null;
}

async function seriesInfoOf(night: GameNightRow): Promise<SeriesInfo | null> {
  if (night.seriesId === null) return null;
  const rows = await getDb()
    .select()
    .from(gameNightSeries)
    .where(eq(gameNightSeries.id, night.seriesId))
    .limit(1);
  return rows.length > 0
    ? { id: rows[0].id, token: rows[0].token, endedAt: rows[0].endedAt }
    : null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One week later, holding the wall-clock time steady in the given timezone —
 * "every Tue 7pm" stays 7pm across a DST change instead of drifting an hour.
 */
export function plusWeek(t: number, timezone: string | null): number {
  const naive = t + WEEK_MS;
  if (!timezone) return naive;
  try {
    const minutesOfDay = (ms: number): number => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(ms);
      const h = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
      const m = Number(parts.find((p) => p.type === 'minute')!.value);
      return h * 60 + m;
    };
    let diff = minutesOfDay(t) - minutesOfDay(naive);
    // The wall-clock delta is at most the DST hour; anything near ±24h is the
    // same delta wrapped across midnight.
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return naive + diff * 60_000;
  } catch {
    return naive;
  }
}

/**
 * Lazy materialization (E125): make sure a live series has an upcoming,
 * non-cancelled occurrence. The new night is a copy of the series' *latest*
 * night — title, place, notes, timezone, and the invite list all carry
 * forward, so the latest occurrence IS the template and editing this week's
 * night is how the template evolves. Steps a week at a time past unmaterialized
 * weeks and cancelled ("skipped") slots; the unique (series_id, starts_at)
 * index makes concurrent calls collapse into one row.
 */
async function ensureNextOccurrence(seriesId: string): Promise<void> {
  const pool = getPool();
  // Each pass inserts a slot or steps past a cancelled one; 8 outlasts any
  // realistic chain of consecutively skipped weeks.
  for (let pass = 0; pass < 8; pass++) {
    const latestRes = await pool.query<{
      id: string;
      host_user_id: string;
      title: string;
      starts_at: string;
      timezone: string | null;
      location: string | null;
      notes: string | null;
      cancelled_at: string | null;
    }>(
      `SELECT id, host_user_id, title, starts_at, timezone, location, notes, cancelled_at
         FROM game_nights WHERE series_id = $1 ORDER BY starts_at DESC LIMIT 1`,
      [seriesId]
    );
    if (latestRes.rows.length === 0) return; // a series is always created with its first night
    const latest = latestRes.rows[0];
    const now = Date.now();
    if (Number(latest.starts_at) > now && latest.cancelled_at === null) return;
    let t = Number(latest.starts_at);
    do {
      t = plusWeek(t, latest.timezone);
    } while (t <= now);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO game_nights (id, token, host_user_id, title, starts_at, timezone, location, notes, created_at, cancelled_at, series_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)
       ON CONFLICT (series_id, starts_at) WHERE series_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        crypto.randomUUID(),
        newToken(),
        latest.host_user_id,
        latest.title,
        t,
        latest.timezone,
        latest.location,
        latest.notes,
        now,
        seriesId,
      ]
    );
    if (inserted.rows.length === 0) continue; // slot already exists (race, or cancelled) — re-read
    const nightId = inserted.rows[0].id;
    // The standing invite list carries forward from the latest occurrence.
    await pool.query(
      `INSERT INTO game_night_invites (night_id, user_id, created_at)
       SELECT $1, user_id, $2 FROM game_night_invites WHERE night_id = $3`,
      [nightId, now, latest.id]
    );
    // The host is going by definition, same as a hand-created night.
    const host = await pool.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1`,
      [latest.host_user_id]
    );
    await pool.query(
      `INSERT INTO game_night_rsvps (id, night_id, user_id, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'going', $5, $5)`,
      [crypto.randomUUID(), nightId, latest.host_user_id, host.rows[0].username, now]
    );
    return;
  }
}

/**
 * The night a series link points at right now: the soonest upcoming
 * non-cancelled occurrence, falling back to the latest occurrence (so an
 * ended or fully skipped series still resolves — the pinned link never dies).
 */
async function resolveSeriesNight(seriesId: string): Promise<{ token: string } | null> {
  const pool = getPool();
  const upcoming = await pool.query<{ token: string }>(
    `SELECT token FROM game_nights
      WHERE series_id = $1 AND starts_at > $2 AND cancelled_at IS NULL
      ORDER BY starts_at ASC LIMIT 1`,
    [seriesId, Date.now()]
  );
  if (upcoming.rows.length > 0) return upcoming.rows[0];
  const latest = await pool.query<{ token: string }>(
    `SELECT token FROM game_nights WHERE series_id = $1 ORDER BY starts_at DESC LIMIT 1`,
    [seriesId]
  );
  return latest.rows[0] ?? null;
}

interface NightView {
  id: string;
  token: string;
  title: string;
  startsAt: number;
  timezone: string | null;
  location: string | null;
  notes: string | null;
  createdAt: number;
  cancelledAt: number | null;
  hostUsername: string;
  isHost: boolean;
  myStatus: RsvpStatus | null;
  rsvps: RsvpView[];
  /** Invited friends who haven't responded yet (host sees who's pending). */
  awaiting: string[];
  /** Candidate date slots while polling; empty once a date is locked in. */
  options: OptionView[];
  /** The weekly series this night belongs to; null for a one-off night. */
  series: SeriesInfo | null;
}

/** Load rsvps + unanswered invites for a set of nights, keyed by night id. */
async function loadNightDetails(nightIds: string[]): Promise<{
  rsvpsByNight: Map<
    string,
    Array<{ userId: string | null; displayName: string; status: RsvpStatus }>
  >;
  awaitingByNight: Map<string, string[]>;
}> {
  const rsvpsByNight = new Map<
    string,
    Array<{ userId: string | null; displayName: string; status: RsvpStatus }>
  >();
  const awaitingByNight = new Map<string, string[]>();
  if (nightIds.length === 0) return { rsvpsByNight, awaitingByNight };
  const pool = getPool();
  const rsvps = await pool.query<{
    night_id: string;
    user_id: string | null;
    display_name: string;
    status: RsvpStatus;
  }>(
    `SELECT night_id, user_id, display_name, status FROM game_night_rsvps
      WHERE night_id = ANY($1) ORDER BY created_at ASC`,
    [nightIds]
  );
  for (const r of rsvps.rows) {
    const arr = rsvpsByNight.get(r.night_id) ?? [];
    arr.push({ userId: r.user_id, displayName: r.display_name, status: r.status });
    rsvpsByNight.set(r.night_id, arr);
  }
  const awaiting = await pool.query<{ night_id: string; username: string }>(
    `SELECT i.night_id, u.username FROM game_night_invites i
       JOIN users u ON u.id = i.user_id
      WHERE i.night_id = ANY($1)
        AND NOT EXISTS (
          SELECT 1 FROM game_night_rsvps r
           WHERE r.night_id = i.night_id AND r.user_id = i.user_id
        )
      ORDER BY u.username ASC`,
    [nightIds]
  );
  for (const a of awaiting.rows) {
    const arr = awaitingByNight.get(a.night_id) ?? [];
    arr.push(a.username);
    awaitingByNight.set(a.night_id, arr);
  }
  return { rsvpsByNight, awaitingByNight };
}

function toNightView(
  night: GameNightRow,
  hostUsername: string,
  viewerId: string,
  rsvps: Array<{ userId: string | null; displayName: string; status: RsvpStatus }>,
  awaiting: string[],
  options: LoadedOption[],
  series: SeriesInfo | null
): NightView {
  const mine = rsvps.find((r) => r.userId === viewerId);
  return {
    id: night.id,
    token: night.token,
    title: night.title,
    startsAt: night.startsAt,
    timezone: night.timezone,
    location: night.location,
    notes: night.notes,
    createdAt: night.createdAt,
    cancelledAt: night.cancelledAt,
    hostUsername,
    isHost: night.hostUserId === viewerId,
    myStatus: mine?.status ?? null,
    rsvps: rsvps.map((r) => ({
      displayName: r.displayName,
      status: r.status,
      isHost: r.userId !== null && r.userId === night.hostUserId,
    })),
    awaiting,
    options: toOptionViews(options, (v) => v.userId === viewerId),
    series,
  };
}

/** Validate invitees are accepted friends of the caller. Returns cleaned ids or an error string. */
async function cleanInvitees(callerId: string, raw: unknown): Promise<string[] | string> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
    return 'inviteUserIds must be an array of user ids.';
  }
  const ids = [...new Set(raw as string[])].filter((id) => id !== callerId);
  if (ids.length > MAX_INVITES) {
    return `You can invite up to ${MAX_INVITES} friends.`;
  }
  for (const id of ids) {
    // Also covers a non-existent id (no friendship row) — uniform 403 message.
    if (!(await areFriends(callerId, id))) {
      return 'You can only invite friends.';
    }
  }
  return ids;
}

/**
 * Create a game night; optionally invite friends. The host is auto-RSVP'd as
 * going. Passing `options` (2–5 epoch-ms slots) instead of `startsAt` starts
 * the night in a date-polling phase (E124): attendees vote on the slots and
 * the host locks one in later. While polling, `startsAt` mirrors the latest
 * candidate so the upcoming-list and grace-window queries need no special case.
 */
gameNightsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const title = cleanRequired(body.title, TITLE_MAX);
  if (!title) {
    return res.status(400).json({ error: `title is required (max ${TITLE_MAX} characters).` });
  }
  let optionSlots: number[] = [];
  if (body.options !== undefined) {
    const cleaned = cleanOptionSlots(body.options);
    if (typeof cleaned === 'string') {
      return res.status(400).json({ error: cleaned });
    }
    optionSlots = cleaned;
  }
  if (optionSlots.length === 0 && !isValidStartsAt(body.startsAt)) {
    return res.status(400).json({ error: 'startsAt must be a valid epoch-ms timestamp.' });
  }
  // A weekly series (E125) needs a set date to step from — a date poll decides
  // one occurrence, not the cadence.
  if (body.repeatsWeekly === true && optionSlots.length > 0) {
    return res
      .status(400)
      .json({ error: 'A weekly night needs a set date — you can vote on a single night instead.' });
  }
  const location = cleanOptional(body.location, LOCATION_MAX) ?? null;
  const notes = cleanOptional(body.notes, NOTES_MAX) ?? null;
  const invitees = await cleanInvitees(req.user!.id, body.inviteUserIds);
  if (typeof invitees === 'string') {
    const status = invitees === 'You can only invite friends.' ? 403 : 400;
    return res.status(status).json({ error: invitees });
  }

  const now = Date.now();
  const db = getDb();
  let series: SeriesInfo | null = null;
  if (body.repeatsWeekly === true) {
    series = { id: crypto.randomUUID(), token: newToken(), endedAt: null };
    await db.insert(gameNightSeries).values({
      id: series.id,
      token: series.token,
      hostUserId: req.user!.id,
      createdAt: now,
      endedAt: null,
    });
  }
  const night = {
    id: crypto.randomUUID(),
    token: newToken(),
    hostUserId: req.user!.id,
    title,
    startsAt: optionSlots.length > 0 ? Math.max(...optionSlots) : (body.startsAt as number),
    timezone: cleanTimezone(body.timezone),
    location,
    notes,
    createdAt: now,
    cancelledAt: null,
    seriesId: series?.id ?? null,
  };
  await db.insert(gameNights).values(night);
  if (optionSlots.length > 0) {
    await db.insert(gameNightOptions).values(
      optionSlots.map((startsAt) => ({
        id: crypto.randomUUID(),
        nightId: night.id,
        startsAt,
        proposedBy: null,
        createdAt: now,
      }))
    );
  }
  if (invitees.length > 0) {
    await db
      .insert(gameNightInvites)
      .values(invitees.map((userId) => ({ nightId: night.id, userId, createdAt: now })));
  }
  // The host is going by definition — keeps tallies and the attendee list honest.
  await db.insert(gameNightRsvps).values({
    id: crypto.randomUUID(),
    nightId: night.id,
    userId: req.user!.id,
    displayName: req.user!.username,
    status: 'going',
    createdAt: now,
    updatedAt: now,
  });

  const { rsvpsByNight, awaitingByNight } = await loadNightDetails([night.id]);
  const optionsByNight = await loadNightOptions([night.id]);
  res.status(201).json({
    night: toNightView(
      night,
      req.user!.username,
      req.user!.id,
      rsvpsByNight.get(night.id) ?? [],
      awaitingByNight.get(night.id) ?? [],
      optionsByNight.get(night.id) ?? [],
      series
    ),
  });
});

/**
 * The caller's game nights: hosting, invited to, or RSVP'd to (e.g. joined via
 * link while signed in). Upcoming plus a 24h grace window; soonest first.
 * Cancelled nights stay listed until they age out so invitees see the cancellation.
 */
gameNightsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const pool = getPool();
  // Lazy materialization (E125): before listing, make sure every live series
  // the caller is part of has its next occurrence — reading the list is the
  // trigger, no cron. A user's series count is tiny, so N small queries is fine.
  const liveSeries = await pool.query<{ id: string }>(
    `SELECT s.id FROM game_night_series s
      WHERE s.ended_at IS NULL
        AND (s.host_user_id = $1
          OR EXISTS (SELECT 1 FROM game_nights n
                       JOIN game_night_invites i ON i.night_id = n.id
                      WHERE n.series_id = s.id AND i.user_id = $1)
          OR EXISTS (SELECT 1 FROM game_nights n
                       JOIN game_night_rsvps r ON r.night_id = n.id
                      WHERE n.series_id = s.id AND r.user_id = $1))`,
    [req.user!.id]
  );
  for (const s of liveSeries.rows) {
    await ensureNextOccurrence(s.id);
  }
  const rows = await pool.query<{
    id: string;
    token: string;
    host_user_id: string;
    title: string;
    starts_at: string;
    timezone: string | null;
    location: string | null;
    notes: string | null;
    created_at: string;
    cancelled_at: string | null;
    series_id: string | null;
    host_username: string;
    series_token: string | null;
    series_ended_at: string | null;
  }>(
    `SELECT n.*, u.username AS host_username, s.token AS series_token, s.ended_at AS series_ended_at
       FROM game_nights n
       JOIN users u ON u.id = n.host_user_id
       LEFT JOIN game_night_series s ON s.id = n.series_id
      WHERE n.starts_at >= $2
        AND (n.host_user_id = $1
          OR EXISTS (SELECT 1 FROM game_night_invites i
                      WHERE i.night_id = n.id AND i.user_id = $1)
          OR EXISTS (SELECT 1 FROM game_night_rsvps r
                      WHERE r.night_id = n.id AND r.user_id = $1))
      ORDER BY n.starts_at ASC`,
    [req.user!.id, Date.now() - GRACE_MS]
  );
  const { rsvpsByNight, awaitingByNight } = await loadNightDetails(rows.rows.map((r) => r.id));
  const optionsByNight = await loadNightOptions(rows.rows.map((r) => r.id));
  const nights = rows.rows.map((r) =>
    toNightView(
      {
        id: r.id,
        token: r.token,
        hostUserId: r.host_user_id,
        title: r.title,
        startsAt: Number(r.starts_at),
        timezone: r.timezone,
        location: r.location,
        notes: r.notes,
        createdAt: Number(r.created_at),
        cancelledAt: r.cancelled_at === null ? null : Number(r.cancelled_at),
        seriesId: r.series_id,
      },
      r.host_username,
      req.user!.id,
      rsvpsByNight.get(r.id) ?? [],
      awaitingByNight.get(r.id) ?? [],
      optionsByNight.get(r.id) ?? [],
      r.series_id === null || r.series_token === null
        ? null
        : {
            id: r.series_id,
            token: r.series_token,
            endedAt: r.series_ended_at === null ? null : Number(r.series_ended_at),
          }
    )
  );
  res.json({ nights });
});

/** Edit a night (host only): details and/or additional friend invites. */
gameNightsRouter.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const db = getDb();
  const found = await db
    .select()
    .from(gameNights)
    .where(and(eq(gameNights.id, id), eq(gameNights.hostUserId, req.user!.id)))
    .limit(1);
  if (found.length === 0) {
    // Non-host gets the same 404 as a bad id — don't confirm the night exists.
    return res.status(404).json({ error: 'Game night not found.' });
  }
  const night = found[0];
  if (night.cancelledAt !== null) {
    return res.status(400).json({ error: 'This game night was cancelled.' });
  }

  const body = req.body as Record<string, unknown>;
  const patch: Partial<typeof night> = {};
  if (body.title !== undefined) {
    const title = cleanRequired(body.title, TITLE_MAX);
    if (!title) {
      return res.status(400).json({ error: `title is required (max ${TITLE_MAX} characters).` });
    }
    patch.title = title;
  }
  const nightOptions = (await loadNightOptions([id])).get(id) ?? [];
  if (body.startsAt !== undefined) {
    if (nightOptions.length > 0) {
      // While polling, the date comes from the poll — lock in an option instead.
      return res.status(400).json({ error: 'This night is voting on a date. Lock one in first.' });
    }
    if (!isValidStartsAt(body.startsAt)) {
      return res.status(400).json({ error: 'startsAt must be a valid epoch-ms timestamp.' });
    }
    patch.startsAt = body.startsAt;
  }
  if (body.timezone !== undefined) patch.timezone = cleanTimezone(body.timezone);
  if (body.location !== undefined)
    patch.location = cleanOptional(body.location, LOCATION_MAX) ?? null;
  if (body.notes !== undefined) patch.notes = cleanOptional(body.notes, NOTES_MAX) ?? null;
  const invitees = await cleanInvitees(req.user!.id, body.addInviteUserIds);
  if (typeof invitees === 'string') {
    const status = invitees === 'You can only invite friends.' ? 403 : 400;
    return res.status(status).json({ error: invitees });
  }

  if (Object.keys(patch).length > 0) {
    await db.update(gameNights).set(patch).where(eq(gameNights.id, id));
  }
  if (invitees.length > 0) {
    const now = Date.now();
    await getPool().query(
      `INSERT INTO game_night_invites (night_id, user_id, created_at)
       SELECT $1, unnest($2::text[]), $3
       ON CONFLICT DO NOTHING`,
      [id, invitees, now]
    );
  }

  const updated = { ...night, ...patch };
  const { rsvpsByNight, awaitingByNight } = await loadNightDetails([id]);
  res.json({
    night: toNightView(
      updated,
      req.user!.username,
      req.user!.id,
      rsvpsByNight.get(id) ?? [],
      awaitingByNight.get(id) ?? [],
      nightOptions,
      await seriesInfoOf(night)
    ),
  });
});

/**
 * Lock in a poll option (host only): the night flips to the plain scheduled
 * shape — `startsAt` becomes the chosen slot and the options (with their
 * votes, via cascade) are deleted. Everything downstream (RSVPs, calendar,
 * OG unfurl) then behaves exactly like a night created with a single date.
 */
gameNightsRouter.post('/:id/lock', requireAuth, async (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const db = getDb();
  const found = await db
    .select()
    .from(gameNights)
    .where(and(eq(gameNights.id, id), eq(gameNights.hostUserId, req.user!.id)))
    .limit(1);
  if (found.length === 0) {
    return res.status(404).json({ error: 'Game night not found.' });
  }
  const night = found[0];
  if (night.cancelledAt !== null) {
    return res.status(400).json({ error: 'This game night was cancelled.' });
  }
  const body = req.body as Record<string, unknown>;
  const optionId = typeof body.optionId === 'string' ? body.optionId : '';
  const pool = getPool();
  const option = await pool.query<{ starts_at: string }>(
    `SELECT starts_at FROM game_night_options WHERE id = $1 AND night_id = $2`,
    [optionId, id]
  );
  if (option.rows.length === 0) {
    return res.status(400).json({ error: 'Pick one of the poll options to lock in.' });
  }
  const startsAt = Number(option.rows[0].starts_at);
  await pool.query(`UPDATE game_nights SET starts_at = $2 WHERE id = $1`, [id, startsAt]);
  await pool.query(`DELETE FROM game_night_options WHERE night_id = $1`, [id]);

  const { rsvpsByNight, awaitingByNight } = await loadNightDetails([id]);
  res.json({
    night: toNightView(
      { ...night, startsAt },
      req.user!.username,
      req.user!.id,
      rsvpsByNight.get(id) ?? [],
      awaitingByNight.get(id) ?? [],
      [],
      await seriesInfoOf(night)
    ),
  });
});

/**
 * Open a date vote on an existing night (host only) — E124's poll attached
 * after creation, so a series occurrence (or any scheduled night) can ask
 * "should we move this one?". Everything downstream — voting, suggesting,
 * lock-in — is the existing poll machinery untouched.
 */
gameNightsRouter.post('/:id/poll', requireAuth, async (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const db = getDb();
  const found = await db
    .select()
    .from(gameNights)
    .where(and(eq(gameNights.id, id), eq(gameNights.hostUserId, req.user!.id)))
    .limit(1);
  if (found.length === 0) {
    return res.status(404).json({ error: 'Game night not found.' });
  }
  const night = found[0];
  const closed = nightClosedError(night);
  if (closed) {
    return res.status(400).json({ error: closed });
  }
  if (((await loadNightOptions([id])).get(id) ?? []).length > 0) {
    return res.status(400).json({ error: 'This night is already voting on a date.' });
  }
  const cleaned = cleanOptionSlots((req.body as Record<string, unknown>).options);
  if (typeof cleaned === 'string') {
    return res.status(400).json({ error: cleaned });
  }
  const now = Date.now();
  await db.insert(gameNightOptions).values(
    cleaned.map((startsAt) => ({
      id: crypto.randomUUID(),
      nightId: id,
      startsAt,
      proposedBy: null,
      createdAt: now,
    }))
  );
  // The polling invariant: while voting, startsAt mirrors the latest candidate.
  const startsAt = Math.max(...cleaned);
  await getPool().query(`UPDATE game_nights SET starts_at = $2 WHERE id = $1`, [id, startsAt]);

  const { rsvpsByNight, awaitingByNight } = await loadNightDetails([id]);
  res.status(201).json({
    night: toNightView(
      { ...night, startsAt },
      req.user!.username,
      req.user!.id,
      rsvpsByNight.get(id) ?? [],
      awaitingByNight.get(id) ?? [],
      (await loadNightOptions([id])).get(id) ?? [],
      await seriesInfoOf(night)
    ),
  });
});

/**
 * Stop a series repeating (host only). Existing occurrences — including the
 * already-materialized upcoming one — stay as plain nights; the series link
 * keeps resolving to the latest of them instead of going dead.
 */
gameNightsRouter.delete('/series/:id', requireAuth, async (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const updated = await getDb()
    .update(gameNightSeries)
    .set({ endedAt: Date.now() })
    .where(
      and(
        eq(gameNightSeries.id, id),
        eq(gameNightSeries.hostUserId, req.user!.id),
        isNull(gameNightSeries.endedAt)
      )
    )
    .returning({ id: gameNightSeries.id });
  if (updated.length === 0) {
    // Non-host gets the same 404 as a bad id — don't confirm the series exists.
    return res.status(404).json({ error: 'Series not found.' });
  }
  res.status(204).end();
});

/**
 * Resolve a stable series link (E125) to the night it currently points at —
 * the pinnable /gn/s/:token URL. Reading it materializes the next occurrence
 * when one is due, so a pinned link stays fresh even if the host never opens
 * the app. Token contract mirrors nights: unknown 404s; an ended series stays
 * resolvable to its last night.
 */
gameNightsRouter.get(
  '/public/series/:token',
  publicLimiter,
  async (req: Request, res: Response) => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const rows = await getPool().query<{ id: string; ended_at: string | null }>(
      `SELECT id, ended_at FROM game_night_series WHERE token = $1`,
      [token]
    );
    if (rows.rows.length === 0) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    const series = rows.rows[0];
    if (series.ended_at === null) {
      await ensureNextOccurrence(series.id);
    }
    const night = await resolveSeriesNight(series.id);
    if (!night) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    res.json({ nightToken: night.token });
  }
);

/** Cancel a night (host only). The link keeps working and shows the cancelled state. */
gameNightsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const db = getDb();
  const updated = await db
    .update(gameNights)
    .set({ cancelledAt: Date.now() })
    .where(
      and(
        eq(gameNights.id, id),
        eq(gameNights.hostUserId, req.user!.id),
        isNull(gameNights.cancelledAt)
      )
    )
    .returning({ id: gameNights.id });
  if (updated.length === 0) {
    return res.status(404).json({ error: 'Game night not found.' });
  }
  res.status(204).end();
});

async function findNightByToken(
  token: string
): Promise<{ night: GameNightRow; hostUsername: string; series: SeriesInfo | null } | null> {
  const pool = getPool();
  const rows = await pool.query<{
    id: string;
    token: string;
    host_user_id: string;
    title: string;
    starts_at: string;
    timezone: string | null;
    location: string | null;
    notes: string | null;
    created_at: string;
    cancelled_at: string | null;
    series_id: string | null;
    host_username: string;
    series_token: string | null;
    series_ended_at: string | null;
  }>(
    `SELECT n.*, u.username AS host_username, s.token AS series_token, s.ended_at AS series_ended_at
       FROM game_nights n
       JOIN users u ON u.id = n.host_user_id
       LEFT JOIN game_night_series s ON s.id = n.series_id
      WHERE n.token = $1`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    night: {
      id: r.id,
      token: r.token,
      hostUserId: r.host_user_id,
      title: r.title,
      startsAt: Number(r.starts_at),
      timezone: r.timezone,
      location: r.location,
      notes: r.notes,
      createdAt: Number(r.created_at),
      cancelledAt: r.cancelled_at === null ? null : Number(r.cancelled_at),
      seriesId: r.series_id,
    },
    hostUsername: r.host_username,
    series:
      r.series_id === null || r.series_token === null
        ? null
        : {
            id: r.series_id,
            token: r.series_token,
            endedAt: r.series_ended_at === null ? null : Number(r.series_ended_at),
          },
  };
}

/**
 * Public read — anyone with the link, no account needed. `myRsvp` resolves the
 * caller's own row (authed: by user id; guest: by the `rsvpId` their client
 * stored when they first RSVP'd) so the page can render "you're going" state.
 * Other attendees' row ids are never exposed — a guest rsvpId is the bearer
 * credential for editing that RSVP.
 */
gameNightsRouter.get(
  '/public/:token',
  publicLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const found = await findNightByToken(token);
    if (!found) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    const { night, hostUsername, series } = found;
    const db = getDb();
    const rsvps = await db
      .select()
      .from(gameNightRsvps)
      .where(eq(gameNightRsvps.nightId, night.id))
      .orderBy(gameNightRsvps.createdAt);

    let myRsvp: { id: string; displayName: string; status: RsvpStatus } | null = null;
    if (req.user) {
      const mine = rsvps.find((r) => r.userId === req.user!.id);
      if (mine) myRsvp = { id: mine.id, displayName: mine.displayName, status: mine.status };
    } else if (typeof req.query.rsvpId === 'string') {
      const mine = rsvps.find((r) => r.id === req.query.rsvpId && r.userId === null);
      if (mine) myRsvp = { id: mine.id, displayName: mine.displayName, status: mine.status };
    }

    const options = (await loadNightOptions([night.id])).get(night.id) ?? [];
    res.json({
      night: {
        token: night.token,
        title: night.title,
        startsAt: night.startsAt,
        timezone: night.timezone,
        location: night.location,
        notes: night.notes,
        cancelledAt: night.cancelledAt,
        hostUsername,
        series,
      },
      rsvps: rsvps.map((r) => ({
        displayName: r.displayName,
        status: r.status,
        isHost: r.userId !== null && r.userId === night.hostUserId,
      })),
      myRsvp,
      options: toOptionViews(options, (v) =>
        req.user ? v.userId === req.user.id : myRsvp !== null && v.rsvpId === myRsvp.id
      ),
    });
  }
);

/**
 * RSVP — signed in or not. Authed callers get one row per night (upserted).
 * Guests create a row and get its id back; presenting that id later updates
 * the same row (stale/unknown ids fall through to create, so a guest whose
 * stored id vanished still lands an RSVP instead of an error).
 */
gameNightsRouter.post(
  '/public/:token/rsvp',
  rsvpLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const found = await findNightByToken(token);
    if (!found) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    const { night } = found;
    const closed = nightClosedError(night);
    if (closed) {
      return res.status(400).json({ error: closed });
    }
    const polling = (await loadNightOptions([night.id])).get(night.id) ?? [];
    if (polling.length > 0) {
      // Going/maybe/declined refers to a locked date; while polling, votes are the reply.
      return res
        .status(400)
        .json({ error: 'This night is still voting on a date — check the times you can make.' });
    }

    const body = req.body as Record<string, unknown>;
    if (!isRsvpStatus(body.status)) {
      return res.status(400).json({ error: "status must be 'going', 'maybe', or 'declined'." });
    }
    const status = body.status;
    const displayName = cleanRequired(body.displayName, NAME_MAX);

    const pool = getPool();
    const now = Date.now();

    if (req.user) {
      const name = displayName ?? req.user.username;
      const upsert = await pool.query<{ id: string }>(
        `INSERT INTO game_night_rsvps (id, night_id, user_id, display_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (night_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET status = $5, display_name = $4, updated_at = $6
         RETURNING id`,
        [crypto.randomUUID(), night.id, req.user.id, name, status, now]
      );
      return res.json({ rsvp: { id: upsert.rows[0].id, displayName: name, status } });
    }

    // Guest path. Try updating their existing row first.
    if (typeof body.rsvpId === 'string' && body.rsvpId.length > 0) {
      const updated = await pool.query<{ id: string; display_name: string }>(
        `UPDATE game_night_rsvps
            SET status = $1, display_name = COALESCE($2, display_name), updated_at = $3
          WHERE id = $4 AND night_id = $5 AND user_id IS NULL
          RETURNING id, display_name`,
        [status, displayName, now, body.rsvpId, night.id]
      );
      if (updated.rows.length > 0) {
        const r = updated.rows[0];
        return res.json({ rsvp: { id: r.id, displayName: r.display_name, status } });
      }
    }
    if (!displayName) {
      return res
        .status(400)
        .json({ error: `displayName is required (max ${NAME_MAX} characters).` });
    }
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM game_night_rsvps WHERE night_id = $1`,
      [night.id]
    );
    if (Number(count.rows[0].n) >= MAX_RSVPS) {
      // ponytail: hard cap, no waitlist — no physical game night exceeds this.
      return res.status(400).json({ error: 'This game night is full.' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO game_night_rsvps (id, night_id, user_id, display_name, status, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $5)`,
      [id, night.id, displayName, status, now]
    );
    res.status(201).json({ rsvp: { id, displayName, status } });
  }
);

/**
 * Cast the caller's votes — the full set of slots they can make (checkbox
 * semantics: the sent list replaces their previous votes; an empty list
 * retracts them all). Works signed in or as a guest, with the same identity
 * rules as RSVPs; guests get their rsvp credential back to store.
 */
gameNightsRouter.post(
  '/public/:token/votes',
  rsvpLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const found = await findNightByToken(token);
    if (!found) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    const { night } = found;
    const closed = nightClosedError(night);
    if (closed) {
      return res.status(400).json({ error: closed });
    }
    const pool = getPool();
    const optionRows = await pool.query<{ id: string }>(
      `SELECT id FROM game_night_options WHERE night_id = $1`,
      [night.id]
    );
    if (optionRows.rows.length === 0) {
      return res.status(400).json({ error: 'Voting is closed — a date is locked in.' });
    }

    const body = req.body as Record<string, unknown>;
    const raw = body.optionIds;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'optionIds must be an array of option ids.' });
    }
    const valid = new Set(optionRows.rows.map((r) => r.id));
    const optionIds = [...new Set(raw as string[])];
    if (optionIds.some((id) => !valid.has(id))) {
      return res.status(400).json({ error: 'Unknown option id.' });
    }

    const resolved = await resolveVoterRsvp(night, req.user, body);
    if ('error' in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const now = Date.now();
    await pool.query(
      `DELETE FROM game_night_votes
        WHERE rsvp_id = $1
          AND option_id IN (SELECT id FROM game_night_options WHERE night_id = $2)`,
      [resolved.rsvp.id, night.id]
    );
    if (optionIds.length > 0) {
      await pool.query(
        `INSERT INTO game_night_votes (option_id, rsvp_id, created_at)
         SELECT unnest($1::text[]), $2, $3`,
        [optionIds, resolved.rsvp.id, now]
      );
    }
    res.json({ rsvp: resolved.rsvp });
  }
);

/**
 * Suggest an extra time slot — any attendee can, flagged with their name so
 * the poll shows whose idea it was. Proposing implies being able to make it,
 * so the proposer is auto-voted for their slot.
 */
gameNightsRouter.post(
  '/public/:token/options',
  rsvpLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const found = await findNightByToken(token);
    if (!found) {
      return res.status(404).json({ error: 'Game night not found.' });
    }
    const { night } = found;
    const closed = nightClosedError(night);
    if (closed) {
      return res.status(400).json({ error: closed });
    }
    const pool = getPool();
    const existing = await pool.query<{ starts_at: string }>(
      `SELECT starts_at FROM game_night_options WHERE night_id = $1`,
      [night.id]
    );
    if (existing.rows.length === 0) {
      return res.status(400).json({ error: 'Voting is closed — a date is locked in.' });
    }
    const body = req.body as Record<string, unknown>;
    if (!isValidStartsAt(body.startsAt)) {
      return res.status(400).json({ error: 'startsAt must be a valid epoch-ms timestamp.' });
    }
    if (existing.rows.some((r) => Number(r.starts_at) === body.startsAt)) {
      return res.status(400).json({ error: 'That time is already an option.' });
    }
    if (existing.rows.length >= MAX_OPTIONS) {
      return res.status(400).json({ error: `A poll can have up to ${MAX_OPTIONS} options.` });
    }

    const resolved = await resolveVoterRsvp(night, req.user, body);
    if ('error' in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const now = Date.now();
    const optionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO game_night_options (id, night_id, starts_at, proposed_by, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [optionId, night.id, body.startsAt, resolved.rsvp.displayName, now]
    );
    await pool.query(
      `INSERT INTO game_night_votes (option_id, rsvp_id, created_at) VALUES ($1, $2, $3)`,
      [optionId, resolved.rsvp.id, now]
    );
    // Keep the polling invariant: the night's startsAt mirrors the latest slot.
    await pool.query(`UPDATE game_nights SET starts_at = GREATEST(starts_at, $2) WHERE id = $1`, [
      night.id,
      body.startsAt,
    ]);
    res.status(201).json({ rsvp: resolved.rsvp });
  }
);

/**
 * OG/Twitter unfurl metadata for `/gn/:token` — the link's group-chat preview
 * ("Friday commander — hosted by anna · Fri, Jul 10, 7:00 PM · 3 going").
 * Times render in the host's timezone when we have it, else date-only UTC so
 * we never unfurl a confidently wrong hour.
 */
export async function lookupGameNightLandingMeta(token: string): Promise<ShareLandingMeta | null> {
  const found = await findNightByToken(token);
  if (!found) return null;
  const { night, hostUsername } = found;
  const when = night.timezone
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: night.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(night.startsAt)
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(night.startsAt);
  const going = (
    await getPool().query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM game_night_rsvps WHERE night_id = $1 AND status = 'going'`,
      [night.id]
    )
  ).rows[0].n;
  const optionCount = Number(
    (
      await getPool().query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM game_night_options WHERE night_id = $1`,
        [night.id]
      )
    ).rows[0].n
  );
  const description = night.cancelledAt
    ? `This game night was cancelled.`
    : optionCount > 0
      ? `Voting on a date — ${optionCount} times proposed. Vote on ${SITE_NAME} — no account needed.`
      : `${when}${night.location ? ` · ${night.location}` : ''} · ${going} going. RSVP on ${SITE_NAME} — no account needed.`;
  return {
    title: `${night.title} — hosted by ${hostUsername}`,
    description,
    url: `${ORIGIN}/gn/${token}`,
  };
}

/**
 * OG/Twitter unfurl for the stable series link `/gn/s/:token` — the current
 * occurrence's unfurl marked as weekly. Scraper reads materialize the next
 * occurrence too (idempotent), so a pinned link unfurls this week's night.
 */
export async function lookupGameNightSeriesLandingMeta(
  token: string
): Promise<ShareLandingMeta | null> {
  const rows = await getPool().query<{ id: string; ended_at: string | null }>(
    `SELECT id, ended_at FROM game_night_series WHERE token = $1`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  const series = rows.rows[0];
  if (series.ended_at === null) {
    await ensureNextOccurrence(series.id);
  }
  const night = await resolveSeriesNight(series.id);
  if (!night) return null;
  const meta = await lookupGameNightLandingMeta(night.token);
  if (!meta) return null;
  return {
    ...meta,
    description: `Repeats weekly. ${meta.description}`,
    url: `${ORIGIN}/gn/s/${token}`,
  };
}
