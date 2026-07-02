import { logger } from '../logger';
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { and, eq, lt } from 'drizzle-orm';
import { requireAuth } from '../auth';
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

const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 300 });
const createLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

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
 * (`{ ...p, ...patch }`), so we must **whitelist** it to exactly the seven
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
    for (const f of ['deckId', 'deckName', 'commander'] as const) {
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
 */
async function sweepStale(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const db = getDb();
  await db.delete(gameSessions).where(lt(gameSessions.updatedAt, cutoff));
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
      : req.user!.username;

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
 * GET /api/games/:code — fetch the current state. Requires auth but not
 * participation.
 *
 * The poll loop sends `?knownVersion=N`. When it matches the stored version we
 * return `{ unchanged: true }` and — crucially — never SELECT the `state`
 * JSONB column, so an idle poll costs a tiny `version`-only row read instead of
 * shipping the whole game state out of the database on every 2.5s tick.
 */
gamesRouter.get('/:code', requireAuth, async (req: Request, res: Response) => {
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
  res.json({ game: row.state as GameState });
});

/** POST /api/games/:code/join — claim a seat. */
gamesRouter.post('/:code/join', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const body = req.body as {
    name?: unknown;
    deckId?: unknown;
    deckName?: unknown;
    commander?: unknown;
    colorIdentity?: unknown;
  };
  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim().slice(0, 40)
      : req.user!.username;

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
    return res.json({ deleted: true });
  }
  if (current.status === 'lobby') {
    const next = applyAction(current, { type: 'remove-player', seat: me.seat });
    await db
      .update(gameSessions)
      .set({ state: next, status: next.status, version: next.version, updatedAt: next.updatedAt })
      .where(eq(gameSessions.code, code));
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
  res.json({ game: next });
});
