import { logger } from '../logger';
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter, isTest } from '../route-utils';
import { and, eq, lt } from 'drizzle-orm';
import { requireAuth, resolveDisplayLabel } from '../auth';
import { getDb, getPool } from '../db';
import { gameSessions } from '../db/schema';
import { persistGameResult } from '../games/persist-result';
import {
  applyAction,
  createGameState,
  makePlayer,
  type GameAction,
  type GameFormat,
  type GamePlayer,
  type GameState,
} from '../games/state';

export const gamesRouter: Router = Router();

// 200/min covers the 2.5s poll loop with room for several players and tabs
// behind one NAT, while still throttling a scripted sweep of the code space.
// Also covers /events (SSE) and /poll (long-poll): a legitimate client opens
// the SSE stream once per session and reconnects at most a handful of times
// an hour; a long-poll client only re-issues when its held request resolves
// (a broadcast — itself bounded by writeLimiter below — or the ~25s
// timeout), so its steady-state rate is *lower* than the 2.5s poll this
// budget was already sized for. Sharing the one budget still leaves headroom
// while keeping the same per-minute ceiling on a scripted code sweep that
// the comment above GET /:code explains.
const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 200 });
const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 300 });
const createLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

/**
 * Real-time fanout — in-process only. `/events` (SSE) and `/poll`
 * (long-poll, for native — see games-longpoll.ts on the client) both
 * register a `Subscriber` here, keyed by code; a mutating route calls
 * `broadcastGameState` / `broadcastGameDeleted` after it commits, and every
 * subscriber for that code gets notified. An SSE subscriber writes the frame
 * to its still-open stream; a long-poll subscriber resolves its held request
 * once and is removed — see GET /:code/poll.
 *
 * ponytail: this only reaches subscribers on the SAME machine. Fine today —
 * fly.toml pins `min_machines_running = 1`, so there's exactly one process —
 * but `auto_start_machines = true` means Fly can spin up a second machine
 * under load, and that instance's subscribers would silently stop getting
 * pushes (they still fall back to the client's poll loop, just laggy).
 * Upgrade path if that ever matters: Postgres LISTEN/NOTIFY on
 * game_sessions, or Redis pub/sub, so every instance rebroadcasts to its own
 * local subscribers on notify instead of assuming they're all local.
 */
interface Subscriber {
  onState: (state: GameState) => void;
  onDeleted: () => void;
  onBoard?: (seat: number, board: unknown) => void;
}
const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Latest published `PublicBoard` per seat, per game code — see POST
 * `/:code/board` below. In-memory only, same single-process ceiling as
 * `subscribers` above (see its comment: fine today under `min_machines_running
 * = 1`, would silently stop fanning out to a second Fly machine if
 * `auto_start_machines` ever spins one up under load). Deliberately NOT part
 * of `game_sessions.state` — that column is version-CAS'd and every card move
 * would bump the game `version`, invalidating every client's `since`/
 * `knownVersion` fast path for a routine drag. Boards are ephemeral and
 * high-frequency; losing them on a restart is fine, since a client just
 * republishes on its next debounced tick (see frontend `games-board.ts`).
 *
 * Bounded the same way `subscribers` is: entries only exist for codes with a
 * live `game_sessions` row, and `broadcastGameDeleted` (called on host leave
 * and now on `sweepStale`) evicts a code's boards the moment its session goes
 * away — so this never accumulates beyond the live+recently-active session
 * count.
 */
const boards = new Map<string, Map<number, unknown>>();

function boardsSnapshot(code: string): Array<{ seat: number; board: unknown }> {
  const codeBoards = boards.get(code);
  if (!codeBoards || codeBoards.size === 0) return [];
  return Array.from(codeBoards, ([seat, board]) => ({ seat, board }));
}

function broadcastGameState(code: string, state: GameState): void {
  const subs = subscribers.get(code);
  if (!subs || subs.size === 0) return;
  for (const sub of subs) sub.onState(state);
}

function broadcastBoard(code: string, seat: number, board: unknown): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  for (const sub of subs) sub.onBoard?.(seat, board);
}

/** Notifies every subscriber for a deleted session so clients notice immediately. */
function broadcastGameDeleted(code: string): void {
  const subs = subscribers.get(code);
  if (subs) {
    for (const sub of subs) sub.onDeleted();
    subscribers.delete(code);
  }
  boards.delete(code);
}

function addSubscriber(code: string, sub: Subscriber): void {
  let subs = subscribers.get(code);
  if (!subs) {
    subs = new Set();
    subscribers.set(code, subs);
  }
  subs.add(sub);
}

function removeSubscriber(code: string, sub: Subscriber): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  subs.delete(sub);
  if (subs.size === 0) subscribers.delete(code);
}

const VALID_FORMATS: ReadonlyArray<GameFormat> = [
  'commander',
  'standard',
  'modern',
  'pioneer',
  'legacy',
  'vintage',
  'pauper',
  'brawl',
  'casual',
];

/** 4-char codes — base32-style without easily-confused chars. ~1M possibilities. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

async function generateUniqueCode(): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const existing = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(eq(gameSessions.code, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error('Could not allocate a unique game code.');
}

const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const VALID_PANEL_KEYS = new Set(['W', 'U', 'B', 'R', 'G', 'M', 'C']);
function sanitizeColorIdentity(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const up = v.toUpperCase();
    if (VALID_COLORS.has(up) && !out.includes(up)) out.push(up);
  }
  return out;
}
/** Whitelist panel color override; anything else falls back to auto (null). */
function sanitizePanelColorKey(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') return null;
  const up = raw.toUpperCase();
  return VALID_PANEL_KEYS.has(up) ? up : null;
}

type UpdatePlayerPatch = Extract<GameAction, { type: 'update-player' }>['patch'];

/**
 * Scrub user-controllable fields on actions before they hit the reducer.
 * The reducer is pure and trusts its inputs; the route is the place to
 * enforce that.
 *
 * For `update-player`, the reducer spreads `patch` onto the player wholesale
 * (`{ ...p, ...patch }`), so we must **whitelist** it to exactly the eight
 * declared fields — otherwise a participant could smuggle `userId`, `isHost`,
 * `life`, or `eliminated` into their own seat, and those land verbatim in the
 * permanent `game_results` row. Never widen this without matching the
 * `GameAction` `update-player` type. Also caps `name` at 40 chars, matching
 * the create/join paths.
 */
function sanitizeAction(action: GameAction): GameAction {
  if (action.type === 'update-player' && action.patch) {
    const raw = action.patch as Record<string, unknown>;
    const patch: UpdatePlayerPatch = {};
    if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
      patch.name = raw.name.trim().slice(0, 40);
    }
    for (const f of ['deckId', 'deckName', 'commander', 'partner'] as const) {
      if (f in raw) patch[f] = typeof raw[f] === 'string' ? (raw[f] as string) : null;
    }
    if ('colorIdentity' in raw) patch.colorIdentity = sanitizeColorIdentity(raw.colorIdentity);
    if ('panelColorKey' in raw) patch.panelColorKey = sanitizePanelColorKey(raw.panelColorKey);
    if ('connected' in raw) patch.connected = raw.connected === true;
    return { ...action, patch };
  }
  return action;
}

/**
 * Reject actions carrying non-finite numeric fields before they reach the
 * reducer, which does raw arithmetic (e.g. `p.life + delta`). A string delta
 * like `"oops"` would otherwise stringify life (`"40oops"`) and permanently
 * defeat the `life <= 0` loss check. Returns an error string or null.
 */
function numericFieldError(action: GameAction): string | null {
  const check = (v: unknown, field: string): string | null =>
    typeof v === 'number' && Number.isFinite(v) ? null : `Invalid ${field}.`;
  switch (action.type) {
    case 'life':
    case 'poison':
      return check(action.delta, 'delta');
    case 'set-life':
      return check(action.value, 'value');
    case 'cmd-dmg':
      return check(action.delta, 'delta') ?? check(action.fromSeat, 'fromSeat');
    case 'end':
      return action.winnerSeat === null ? null : check(action.winnerSeat, 'winnerSeat');
    default:
      return null;
  }
}

function isParticipant(state: GameState, userId: string): boolean {
  if (state.hostUserId === userId) return true;
  return state.players.some((p) => p.userId === userId);
}

function nextOpenSeat(state: GameState, max: number): number {
  for (let s = 0; s < max; s++) {
    if (!state.players.some((p) => p.seat === s)) return s;
  }
  return state.players.length;
}

/**
 * Sweep sessions older than 24h. Cheap to call inline on creates so we don't
 * need a separate worker.
 *
 * Must broadcast the deletion for every code it sweeps — an SSE stream is
 * otherwise still "healthy" (its 25s heartbeat keeps writing to a genuinely
 * open connection) with nothing left to ever tell it the session is gone, so
 * a swept game would sit on screen looking live forever. `broadcastGameDeleted`
 * is the same teardown host-leave already uses, so this also evicts the
 * code's `boards` entry (see the comment above the `boards` map).
 */
async function sweepStale(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const db = getDb();
  const deleted = await db
    .delete(gameSessions)
    .where(lt(gameSessions.updatedAt, cutoff))
    .returning({ code: gameSessions.code });
  for (const { code } of deleted) broadcastGameDeleted(code);
}

/** POST /api/games — create a new session (host). */
gamesRouter.post('/', createLimiter, requireAuth, async (req: Request, res: Response) => {
  const body = req.body as {
    format?: unknown;
    startingLife?: unknown;
    commanderDamageEnabled?: unknown;
    poisonEnabled?: unknown;
    hostName?: unknown;
    hostDeckId?: unknown;
    hostDeckName?: unknown;
    hostCommander?: unknown;
    hostPartner?: unknown;
    hostColorIdentity?: unknown;
  };

  const format =
    typeof body.format === 'string' && VALID_FORMATS.includes(body.format as GameFormat)
      ? (body.format as GameFormat)
      : 'commander';
  const startingLife =
    typeof body.startingLife === 'number' && body.startingLife > 0 && body.startingLife <= 200
      ? Math.floor(body.startingLife)
      : format === 'commander' || format === 'brawl'
        ? 40
        : 20;
  const commanderDamageEnabled =
    typeof body.commanderDamageEnabled === 'boolean'
      ? body.commanderDamageEnabled
      : format === 'commander';
  const poisonEnabled = typeof body.poisonEnabled === 'boolean' ? body.poisonEnabled : false;
  const hostName =
    typeof body.hostName === 'string' && body.hostName.trim().length > 0
      ? body.hostName.trim().slice(0, 40)
      : await resolveDisplayLabel(req.user!.id);

  void sweepStale().catch((err) => logger.warn('[games] sweep failed', err));

  const id = crypto.randomUUID();
  const now = Date.now();

  const hostPlayer: GamePlayer = makePlayer({
    id: req.user!.id,
    userId: req.user!.id,
    seat: 0,
    name: hostName,
    deckId: typeof body.hostDeckId === 'string' ? body.hostDeckId : null,
    deckName: typeof body.hostDeckName === 'string' ? body.hostDeckName : null,
    commander: typeof body.hostCommander === 'string' ? body.hostCommander : null,
    partner: typeof body.hostPartner === 'string' ? body.hostPartner : null,
    colorIdentity: sanitizeColorIdentity(body.hostColorIdentity),
    startingLife,
    isHost: true,
  });

  const db = getDb();

  // The pre-check in generateUniqueCode narrows collisions but can't prevent
  // two concurrent creates picking the same code, so catch the resulting
  // unique-violation (Postgres 23505) on `code` and re-roll rather than 500.
  for (let attempt = 0; ; attempt++) {
    const code = await generateUniqueCode();
    const state = createGameState({
      id,
      code,
      mode: 'online',
      hostUserId: req.user!.id,
      format,
      startingLife,
      commanderDamageEnabled,
      poisonEnabled,
      players: [hostPlayer],
      ts: now,
    });

    try {
      await db.insert(gameSessions).values({
        id,
        code,
        hostUserId: req.user!.id,
        status: state.status,
        state,
        version: state.version,
        createdAt: now,
        updatedAt: now,
      });
      res.status(201).json({ game: state });
      return;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 5) continue;
      throw err;
    }
  }
});

/**
 * GET /api/games/:code — fetch the current state. Requires auth AND a seat.
 *
 * Join codes are 4 characters (~1M of them), so an unthrottled, unscoped read
 * let any one account sweep the whole space and harvest every live session's
 * full `GameState` — every seat's account id, display name, deck name and
 * commander. A non-participant now gets the same 404 as an unknown code, so a
 * sweep yields nothing; `POST /:code/join` remains the entry point, and the
 * client never GETs a game it hasn't joined (see store/play.ts joinOnline,
 * which calls join directly and only then starts the poll loop).
 *
 * The poll loop sends `?knownVersion=N`. When it matches the stored version we
 * return `{ unchanged: true }` and — crucially — never SELECT the `state`
 * JSONB column, so an idle poll costs a tiny `version`-only row read instead of
 * shipping the whole game state out of the database on every 2.5s tick. That
 * fast path carries no game data, so it stays ahead of the seat check.
 */
gamesRouter.get('/:code', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const meta = await db
    .select({ version: gameSessions.version })
    .from(gameSessions)
    .where(eq(gameSessions.code, code))
    .limit(1);
  const metaRow = meta[0];
  if (!metaRow) return res.status(404).json({ error: 'Game not found.' });

  const knownVersion = Number(req.query.knownVersion);
  if (Number.isFinite(knownVersion) && metaRow.version === knownVersion) {
    return res.json({ unchanged: true });
  }

  const rows = await db
    .select({ state: gameSessions.state })
    .from(gameSessions)
    .where(eq(gameSessions.code, code))
    .limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  // Stealth 404 — identical to an unknown code, so the response carries no
  // signal about whether the guessed code exists.
  if (!isParticipant(state, req.user!.id)) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  res.json({ game: state });
});

/**
 * GET /api/games/:code/events — Server-Sent Events stream of state changes.
 *
 * Security mirrors GET /:code exactly, including the stealth 404: this reads
 * the full row (not the version-only fast path, since a stream has no
 * `knownVersion` to short-circuit against) and checks `isParticipant` before
 * a single byte of SSE framing is written, so a non-participant gets the
 * identical 404 body an unknown code would — never a hint that the code is
 * live. See the long comment on GET /:code for why that matters (4-char
 * codes, ~1M of them).
 */
gamesRouter.get('/:code/events', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  if (!isParticipant(state, req.user!.id)) {
    return res.status(404).json({ error: 'Game not found.' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  // Catch up a fresh/reconnecting client on boards published before it
  // subscribed — otherwise a joiner sees empty opponent panels until each of
  // them happens to move. One frame per seat currently on file for this code.
  for (const entry of boardsSnapshot(code)) {
    res.write(`event: board\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  // A failed write on this response must never reach the process as an
  // unhandled 'error' event: `backend/src/` installs no `uncaughtException`
  // handler, so one would exit the process and take down every in-progress
  // game for every user — not just this connection.
  //
  // The live path is `broadcastGameDeleted` → `onDeleted` → `res.end()`, which
  // does NOT clear the heartbeat below (only `req.on('close')` does). A
  // heartbeat tick landing in the window between `res.end()` and socket
  // teardown emits ERR_STREAM_WRITE_AFTER_END. Rare (~1ms per 25,000ms per
  // ended game) but the blast radius is the whole server.
  //
  // Writing to an already-DESTROYED socket is separately fine — Node's
  // `OutgoingMessage._writeRaw` returns early on `conn.destroyed` — so this
  // guard is about write-after-end specifically, and retires the whole
  // uncaught-write class in one line.
  res.on('error', () => {});

  const sub: Subscriber = {
    onState: (fresh) => res.write(`event: state\ndata: ${JSON.stringify(fresh)}\n\n`),
    onDeleted: () => res.end(),
    // New write path into this subscriber — guarded the same way the
    // heartbeat below is, for the same reason (see the long comment above
    // it): a write landing in the `onDeleted` → `res.end()` window would
    // otherwise throw ERR_STREAM_WRITE_AFTER_END with nothing to catch it.
    onBoard: (seat, board) => {
      if (!res.writableEnded) {
        res.write(`event: board\ndata: ${JSON.stringify({ seat, board })}\n\n`);
      }
    },
  };
  addSubscriber(code, sub);

  // Fly's proxy (and most others) kills an idle connection; a comment
  // frame every 25s keeps it open without the client parsing it as data.
  // `writableEnded` is what keeps the bad write from being attempted at all —
  // the listener above only makes its fallout non-fatal — and it covers the
  // same `onDeleted` → `res.end()` window described there.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSubscriber(code, sub);
  });
});

// Under test this collapses to a couple hundred ms so the "held then
// released by timeout" test doesn't stall the suite; in production it's
// long enough to avoid hot-looping a native client while staying well under
// Fly's proxy idle-connection timeout.
const POLL_TIMEOUT_MS = isTest ? 200 : 25_000;

/**
 * GET /api/games/:code/poll?since=<version> — long-poll fallback for clients
 * that can't use SSE (native/Capacitor — see games-longpoll.ts's client-side
 * doc comment for why `EventSource` doesn't work there, even though it
 * exists in that WebView). Shares the `subscribers` registry with `/events`:
 * a poll request is just a subscriber that resolves once instead of
 * streaming.
 *
 * Security mirrors GET /:code and /:code/events exactly, including the
 * stealth 404 — see the long comment on GET /:code for why (4-char codes,
 * ~1M of them, sweepable).
 *
 * Semantics: if `since` is already stale (the session's `version` is
 * greater — also true when `since` is missing/invalid) or the caller passes
 * `catchUp=1`, respond immediately with the current state. Otherwise
 * register as a subscriber and hold the request open until either a
 * mutation broadcasts for this code or ~25s elapses, then answer
 * `{ unchanged: true }` — the same shape GET /:code's `knownVersion` fast
 * path uses, so the client's handling of both stays uniform.
 *
 * `catchUp=1` (games-longpoll.ts sends it on a loop's very first request)
 * forces the immediate branch even when `since` already matches: a
 * freshly-joined player's own join just bumped the version they're polling
 * with, so the ordinary staleness check alone would never fire for them and
 * they'd otherwise sit in the held branch — up to ~25s — before ever seeing
 * the current `boards` snapshot (see below).
 *
 * Every response that carries `game` (the immediate branch, and the
 * broadcast-resolved held branch below) also carries the code's current
 * `boards` snapshot, so a client catches up on opponents' published boards
 * any time it receives fresh game state. A board published while a request
 * is held resolves it early with just that one board (`{ board }`) — no
 * `game` needed, cheaper than waiting for the next state broadcast or timeout.
 *
 * Every branch that can end the request (immediate reply, broadcast,
 * deletion, timeout, client disconnect) funnels through `settle`, which is
 * idempotent — guards a timeout and a broadcast racing to resolve the same
 * request, which would otherwise attempt two responses and throw. The
 * timeout and the subscriber registration are always torn down together so
 * a resolved or abandoned request never lingers (load-bearing on a 2GB VM
 * with many concurrently-held long-polls).
 */
gamesRouter.get('/:code/poll', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  if (!isParticipant(state, req.user!.id)) {
    return res.status(404).json({ error: 'Game not found.' });
  }

  const rawSince = Number(req.query.since);
  const since = Number.isFinite(rawSince) ? rawSince : -1;
  const catchUp = req.query.catchUp === '1';
  if (state.version > since || catchUp) {
    return res.json({ game: state, boards: boardsSnapshot(code) });
  }

  let settled = false;
  const timer = setTimeout(() => settle(() => res.json({ unchanged: true })), POLL_TIMEOUT_MS);
  const sub: Subscriber = {
    onState: (fresh) => settle(() => res.json({ game: fresh, boards: boardsSnapshot(code) })),
    onDeleted: () => settle(() => res.status(404).json({ error: 'Game not found.' })),
    onBoard: (seat, board) => settle(() => res.json({ board: { seat, board } })),
  };

  function settle(respond: () => void): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    removeSubscriber(code, sub);
    respond();
  }

  addSubscriber(code, sub);
  req.on('close', () => settle(() => {}));
});

// Board publishes are debounced client-side to ~150ms (see frontend
// games-board.ts), so a single active participant posts at most ~7/s;
// budget generously above that for several players behind one NAT while
// still bounding a scripted flood. An order of magnitude above writeLimiter,
// which is sized for occasional game-state mutations, not a per-move sync.
const boardLimiter = testAwareLimiter({ windowMs: 60_000, max: 1200 });

/** Board payloads are fanned out verbatim to every other participant's
 *  client, so this bounds the total JSON size defensively — generous for a
 *  real `PublicBoard` (a few KB even with a full battlefield), but far below
 *  anything that could bloat the in-memory store or the wire. */
const MAX_BOARD_BYTES = 64 * 1024;

/**
 * Minimal structural check on a claimed `PublicBoard` — enough to keep a
 * malformed or hostile payload from wedging the in-memory `boards` store or
 * crashing a peer's client that trusts the shape, without re-implementing
 * the full projection contract (frontend-only, `lib/playtest/projection.ts`)
 * on the backend.
 */
function isPlausibleBoard(body: unknown): body is Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (!Number.isFinite(b.turn) || !Number.isFinite(b.life)) return false;
  if (!Number.isFinite(b.handCount) || !Number.isFinite(b.libraryCount)) return false;
  return (['battlefield', 'graveyard', 'exile', 'command'] as const).every((zone) =>
    Array.isArray(b[zone])
  );
}

/**
 * POST /api/games/:code/board — publish the caller's `PublicBoard`
 * projection (a redacted, opponent-safe view of one seat's board; see
 * `frontend/src/lib/playtest/projection.ts`) so every other participant's
 * client can render it. Stored per-seat in the `boards` map above and fanned
 * out over the same SSE/long-poll subscribers real game-state mutations use.
 *
 * The seat is never trusted from the body — it's always the authenticated
 * caller's own seat in this session, looked up server-side. That's the whole
 * defense against seat spoofing: even a body explicitly claiming a different
 * seat is silently overwritten, so a participant can never forge another
 * seat's board.
 */
gamesRouter.post('/:code/board', boardLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  // Stealth 404, byte-identical to an unknown code — deliberately NOT a 403.
  // Join codes are 4 chars (~1M of them), so a route that distinguishes
  // "exists but isn't yours" from "no such code" lets one account sweep the
  // space and enumerate every live session. Every sibling route returns this
  // same 404 for exactly that reason (see the long comment on GET /:code); a
  // 403 here would reopen the hole they all close.
  const me = state.players.find((p) => p.userId === req.user!.id);
  if (!me) return res.status(404).json({ error: 'Game not found.' });

  if (JSON.stringify(req.body ?? {}).length > MAX_BOARD_BYTES) {
    return res.status(413).json({ error: 'Board payload too large.' });
  }
  if (!isPlausibleBoard(req.body)) {
    return res.status(400).json({ error: 'Invalid board payload.' });
  }

  const board = { ...req.body, seat: me.seat };
  let codeBoards = boards.get(code);
  if (!codeBoards) {
    codeBoards = new Map();
    boards.set(code, codeBoards);
  }
  codeBoards.set(me.seat, board);

  broadcastBoard(code, me.seat, board);
  res.json({ ok: true });
});

/** POST /api/games/:code/join — claim a seat. */
gamesRouter.post('/:code/join', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const body = req.body as {
    name?: unknown;
    deckId?: unknown;
    deckName?: unknown;
    commander?: unknown;
    partner?: unknown;
    colorIdentity?: unknown;
  };
  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim().slice(0, 40)
      : await resolveDisplayLabel(req.user!.id);

  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const current = row.state as GameState;
  if (current.status !== 'lobby') {
    return res.status(409).json({ error: 'Game has already started.' });
  }
  // Re-join: if the user already has a seat, just mark them connected.
  const existing = current.players.find((p) => p.userId === req.user!.id);
  if (existing) {
    const next = applyAction(current, {
      type: 'update-player',
      seat: existing.seat,
      patch: {
        connected: true,
        name,
        deckId: typeof body.deckId === 'string' ? body.deckId : existing.deckId,
        deckName: typeof body.deckName === 'string' ? body.deckName : existing.deckName,
        commander: typeof body.commander === 'string' ? body.commander : existing.commander,
        partner: typeof body.partner === 'string' ? body.partner : existing.partner,
        colorIdentity:
          body.colorIdentity !== undefined
            ? sanitizeColorIdentity(body.colorIdentity)
            : existing.colorIdentity,
      },
    });
    const updated = await db
      .update(gameSessions)
      .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
      .where(and(eq(gameSessions.code, code), eq(gameSessions.version, current.version)))
      .returning({ version: gameSessions.version });
    if (updated.length === 0) {
      return res.status(409).json({ error: 'Version conflict, please retry.' });
    }
    broadcastGameState(code, next);
    return res.json({ game: next });
  }

  if (current.players.length >= 8) {
    return res.status(409).json({ error: 'Game is full.' });
  }
  const seat = nextOpenSeat(current, 8);
  const player = makePlayer({
    id: req.user!.id,
    userId: req.user!.id,
    seat,
    name,
    deckId: typeof body.deckId === 'string' ? body.deckId : null,
    deckName: typeof body.deckName === 'string' ? body.deckName : null,
    commander: typeof body.commander === 'string' ? body.commander : null,
    partner: typeof body.partner === 'string' ? body.partner : null,
    colorIdentity: sanitizeColorIdentity(body.colorIdentity),
    startingLife: current.startingLife,
    isHost: false,
  });
  const next = applyAction(current, { type: 'add-player', player });
  const updated = await db
    .update(gameSessions)
    .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
    .where(and(eq(gameSessions.code, code), eq(gameSessions.version, current.version)))
    .returning({ version: gameSessions.version });
  if (updated.length === 0) {
    return res.status(409).json({ error: 'Version conflict, please retry.' });
  }
  broadcastGameState(code, next);
  res.json({ game: next });
});

function actionIsAllowed(action: GameAction, state: GameState, userId: string): string | null {
  const isHost = state.hostUserId === userId;
  // Host can do anything. Other authed participants can do gameplay actions
  // (life, poison, cmd-dmg, eliminate, note, update-player for their own seat,
  // and end). They can't add/remove other players, change settings, reset, or
  // start the game — those are host-only.
  if (isHost) return null;
  if (!isParticipant(state, userId)) return 'Not a participant.';

  switch (action.type) {
    case 'start':
    case 'reset':
    case 'settings':
    case 'add-player':
    case 'remove-player':
      return 'Host only.';
    case 'update-player': {
      const target = state.players.find((p) => p.seat === action.seat);
      if (!target) return 'No such seat.';
      if (target.userId !== userId) return 'Can only update your own seat.';
      return null;
    }
    default:
      return null;
  }
}

/** PATCH /api/games/:code — apply a batch of actions atomically. */
gamesRouter.patch('/:code', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const body = req.body as { actions?: unknown; baseVersion?: unknown };
  if (!Array.isArray(body.actions) || body.actions.length === 0) {
    return res.status(400).json({ error: 'actions must be a non-empty array.' });
  }
  if (typeof body.baseVersion !== 'number') {
    return res.status(400).json({ error: 'baseVersion is required.' });
  }
  if (body.actions.length > 50) {
    return res.status(400).json({ error: 'Too many actions in a single request.' });
  }

  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const current = row.state as GameState;
  if (current.version !== body.baseVersion) {
    return res.status(409).json({ error: 'Version conflict.', current });
  }

  let next = current;
  for (const raw of body.actions as GameAction[]) {
    const denied = actionIsAllowed(raw, next, req.user!.id);
    if (denied) return res.status(403).json({ error: denied });
    const numErr = numericFieldError(raw);
    if (numErr) return res.status(400).json({ error: numErr });
    const action = sanitizeAction(raw);
    try {
      next = applyAction(next, action);
    } catch (err) {
      return res
        .status(400)
        .json({ error: err instanceof Error ? err.message : 'Invalid action.' });
    }
  }

  const updated = await db
    .update(gameSessions)
    .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
    .where(and(eq(gameSessions.code, code), eq(gameSessions.version, current.version)))
    .returning({ version: gameSessions.version });
  if (updated.length === 0) {
    // Lost the race — re-fetch and tell the client.
    const fresh = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
    return res
      .status(409)
      .json({ error: 'Version conflict.', current: fresh[0]?.state as GameState | undefined });
  }

  // Canonical shared record: written once, by whichever client wins the
  // optimistic-lock race that flips an online game to 'finished'. Subsequent
  // PATCHes of an already-finished game don't re-fire (current.status check),
  // and persistGameResult is idempotent on session_id besides. Fire-and-forget
  // — a record-write failure must not break the game's PATCH response.
  if (current.status !== 'finished' && next.status === 'finished' && next.mode === 'online') {
    void persistGameResult(next, getPool());
  }

  broadcastGameState(code, next);
  res.json({ game: next });
});

/** POST /api/games/:code/leave — leave the game (lobby-only for non-hosts). */
gamesRouter.post('/:code/leave', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const current = row.state as GameState;
  const me = current.players.find((p) => p.userId === req.user!.id);
  if (!me) return res.json({ game: current });
  if (me.isHost) {
    // Host leave = end + delete.
    await db.delete(gameSessions).where(eq(gameSessions.code, code));
    broadcastGameDeleted(code);
    return res.json({ deleted: true });
  }
  if (current.status === 'lobby') {
    const next = applyAction(current, { type: 'remove-player', seat: me.seat });
    await db
      .update(gameSessions)
      .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
      .where(eq(gameSessions.code, code));
    broadcastGameState(code, next);
    return res.json({ game: next });
  }
  // Mid-game: mark disconnected but keep the seat so life totals are intact.
  const next = applyAction(current, {
    type: 'update-player',
    seat: me.seat,
    patch: { connected: false },
  });
  await db
    .update(gameSessions)
    .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
    .where(eq(gameSessions.code, code));
  broadcastGameState(code, next);
  res.json({ game: next });
});
