import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { testAwareLimiter } from '../route-utils';
import { optionalAuth, requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import { gameNightInvites, gameNightRsvps, gameNights, type GameNightRow } from '../db/schema';
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
  awaiting: string[]
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

/** Create a game night; optionally invite friends. The host is auto-RSVP'd as going. */
gameNightsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const title = cleanRequired(body.title, TITLE_MAX);
  if (!title) {
    return res.status(400).json({ error: `title is required (max ${TITLE_MAX} characters).` });
  }
  if (!isValidStartsAt(body.startsAt)) {
    return res.status(400).json({ error: 'startsAt must be a valid epoch-ms timestamp.' });
  }
  const location = cleanOptional(body.location, LOCATION_MAX) ?? null;
  const notes = cleanOptional(body.notes, NOTES_MAX) ?? null;
  const invitees = await cleanInvitees(req.user!.id, body.inviteUserIds);
  if (typeof invitees === 'string') {
    const status = invitees === 'You can only invite friends.' ? 403 : 400;
    return res.status(status).json({ error: invitees });
  }

  const now = Date.now();
  const night = {
    id: crypto.randomUUID(),
    token: newToken(),
    hostUserId: req.user!.id,
    title,
    startsAt: body.startsAt,
    timezone: cleanTimezone(body.timezone),
    location,
    notes,
    createdAt: now,
    cancelledAt: null,
  };
  const db = getDb();
  await db.insert(gameNights).values(night);
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
  res.status(201).json({
    night: toNightView(
      night,
      req.user!.username,
      req.user!.id,
      rsvpsByNight.get(night.id) ?? [],
      awaitingByNight.get(night.id) ?? []
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
    host_username: string;
  }>(
    `SELECT n.*, u.username AS host_username
       FROM game_nights n
       JOIN users u ON u.id = n.host_user_id
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
      },
      r.host_username,
      req.user!.id,
      rsvpsByNight.get(r.id) ?? [],
      awaitingByNight.get(r.id) ?? []
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
  if (body.startsAt !== undefined) {
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
      awaitingByNight.get(id) ?? []
    ),
  });
});

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
): Promise<{ night: GameNightRow; hostUsername: string } | null> {
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
    host_username: string;
  }>(
    `SELECT n.*, u.username AS host_username
       FROM game_nights n JOIN users u ON u.id = n.host_user_id
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
    },
    hostUsername: r.host_username,
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
    const { night, hostUsername } = found;
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
      },
      rsvps: rsvps.map((r) => ({
        displayName: r.displayName,
        status: r.status,
        isHost: r.userId !== null && r.userId === night.hostUserId,
      })),
      myRsvp,
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
    if (night.cancelledAt !== null) {
      return res.status(400).json({ error: 'This game night was cancelled.' });
    }
    if (night.startsAt < Date.now() - GRACE_MS) {
      return res.status(400).json({ error: 'This game night has already happened.' });
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
  const description = night.cancelledAt
    ? `This game night was cancelled.`
    : `${when}${night.location ? ` · ${night.location}` : ''} · ${going} going. RSVP on ${SITE_NAME} — no account needed.`;
  return {
    title: `${night.title} — hosted by ${hostUsername}`,
    description,
    url: `${ORIGIN}/gn/${token}`,
  };
}
