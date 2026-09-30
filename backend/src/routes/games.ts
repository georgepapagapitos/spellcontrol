import { logger } from '../logger';
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { requireAuth, resolveDisplayLabel } from '../auth';
import { getDb, getPool } from '../db';
import { gameSessions } from '../db/schema';
import { listFriendIds } from '../friends/relations';
import {
  MAX_GAME_NAME_LEN,
  actionIsAllowed,
  invalidCoopOutcomeError,
  invalidHordeSeatCapError,
  invalidHordeSetupError,
  invalidHordeStepError,
  invalidHordeUndoError,
  invalidNameError,
  invalidPhaseError,
  invalidResetIdError,
  invalidTurnOrderError,
  invalidVisibilityError,
  invalidVoiceUrlError,
  noteMessageError,
  numericFieldError,
  sanitizeAction,
  sanitizeBracket,
  sanitizeColorIdentity,
} from '../games/action-validation';
import { persistGameResult } from '../games/persist-result';
import { discordStatus, openDiscordTable } from '../games/discord-tables';
import { createLimiter, readLimiter, writeLimiter } from '../games/limiters';
import {
  broadcastGameDeleted,
  broadcastGameState,
  resolveGameAccess,
  touchPresence,
} from '../games/live-registry';
import {
  LISTING_PAGE_SIZE,
  STALE_LISTING_MS,
  VALID_FORMATS,
  generateUniqueCode,
  isUniqueViolation,
  nextOpenSeat,
  projectGameListing,
  sweepStale,
} from '../games/sessions';
import { streamRouter } from '../games/stream-routes';
import { tableRouter } from '../games/table-routes';
import {
  applyAction,
  createGameState,
  makePlayer,
  MAX_ONLINE_SEATS,
  HORDE_MAX_SEATS,
  nextHostSeat,
  type GameAction,
  type GameFormat,
  type GamePlayer,
  type GameState,
} from '../games/state';

export const gamesRouter: Router = Router();

/**
 * GET /api/games — list public games, plus the caller's friends' friends-only
 * games, for the room browser (board E367, extended for Friends visibility).
 *
 * Every other read route in this file (GET /:code, /events, /poll) requires
 * already knowing the 4-character code; this is the one surface that answers
 * "what tables exist" instead. Scoped hard at the query itself to
 * `visibility: 'public'`, or `visibility: 'friends'` hosted by a user the
 * caller is friends with — a private game (the default), or a friends game
 * hosted by a stranger, must never appear here, and unlike GET /:code there's
 * no per-code stealth-404 to fall back on, so the filter has to be correct in
 * the SQL, not just in what gets projected after. Excludes `'finished'`
 * tables and anything stale (see `STALE_LISTING_MS`), newest-active first,
 * capped at `LISTING_PAGE_SIZE`.
 *
 * The friend-id list is `listFriendIds` (one indexed lookup, shared with
 * `friends.ts` and `game-results.ts` rather than a fourth copy of the same
 * query); matching it against `host_user_id` — a real column, not a JSONB
 * path — reuses `game_sessions_host_idx` rather than adding a new index for
 * this.
 */
gamesRouter.get('/', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  const cutoff = Date.now() - STALE_LISTING_MS;
  const friendIds = await listFriendIds(req.user!.id);

  const visibilityFilter =
    friendIds.length > 0
      ? or(
          sql`${gameSessions.state}->>'visibility' = 'public'`,
          and(
            sql`${gameSessions.state}->>'visibility' = 'friends'`,
            inArray(gameSessions.hostUserId, friendIds)
          )
        )
      : sql`${gameSessions.state}->>'visibility' = 'public'`;

  const rows = await db
    .select({ state: gameSessions.state })
    .from(gameSessions)
    .where(
      and(
        visibilityFilter,
        inArray(gameSessions.status, ['lobby', 'active']),
        gt(gameSessions.updatedAt, cutoff)
      )
    )
    .orderBy(desc(gameSessions.updatedAt))
    .limit(LISTING_PAGE_SIZE);

  res.json({ games: rows.map((r) => projectGameListing(r.state as GameState)) });
});

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
    hostBracket?: unknown;
    name?: unknown;
    visibility?: unknown;
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
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_GAME_NAME_LEN) : '';
  const visibility =
    body.visibility === 'public' ? 'public' : body.visibility === 'friends' ? 'friends' : 'private';

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
    bracket: sanitizeBracket(body.hostBracket),
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
      name,
      visibility,
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
      // Nobody is subscribed to a new table yet; this reaches the change
      // listeners, so a public table is posted to Discord straight away.
      broadcastGameState(code, state);
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
// Ahead of GET /:code, which would otherwise read "discord" as a game code.
gamesRouter.get('/discord', readLimiter, requireAuth, discordStatus);

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
  // Liveness signal for requiredApprovers (see PRESENCE_TTL_MS) — this is the
  // client's 2.5s poll-loop fallback, so a live tab keeps touching this on
  // every tick regardless of which branch below it takes.
  touchPresence(code, req.user!.id);

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
  const { allowed } = await resolveGameAccess(state, req.user!.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  res.json({ game: state });
});

// Order is the route table: the stream, then the board/signal/request routers,
// sit exactly where those routes were before the split.
gamesRouter.use(streamRouter);
gamesRouter.use(tableRouter);

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
    bracket?: unknown;
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
  // The code is the invite at every visibility, `'friends'` included — see
  // `resolveGameAccess`'s doc on the monotone Public ⊇ Friends ⊇ Private
  // rule. `'friends'` only ADDS what a friend gets without the code
  // (discovery in the room browser, spectating via GET); it never subtracts
  // what holding the code already grants a stranger under `'private'`.
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
        bracket: body.bracket !== undefined ? sanitizeBracket(body.bracket) : existing.bracket,
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

  const seatCap = current.format === 'horde' ? HORDE_MAX_SEATS : MAX_ONLINE_SEATS;
  if (current.players.length >= seatCap) {
    return res
      .status(409)
      .json({ error: current.format === 'horde' ? 'This Horde table is full.' : 'Game is full.' });
  }
  const seat = nextOpenSeat(current, seatCap);
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
    bracket: sanitizeBracket(body.bracket),
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

// The 50-action cap above bounds count, not size — a handful of actions can
// still carry an unbounded string (e.g. `note.message` before sanitization,
// or a forged `add-player.player.name`). Mirrors `MAX_BOARD_BYTES`'s
// defense-in-depth role: generous for any legitimate batch, far below
// anything that could bloat the JSONB row or the wire. Checked against the
// raw body, before any per-action sanitization runs.
const MAX_PATCH_BATCH_BYTES = 32 * 1024;

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
  if (JSON.stringify(body.actions).length > MAX_PATCH_BATCH_BYTES) {
    return res.status(413).json({ error: 'Action batch payload too large.' });
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
    const noteErr = noteMessageError(raw);
    if (noteErr) return res.status(400).json({ error: noteErr });
    const phaseErr = invalidPhaseError(raw);
    if (phaseErr) return res.status(400).json({ error: phaseErr });
    const voiceErr = invalidVoiceUrlError(raw);
    if (voiceErr) return res.status(400).json({ error: voiceErr });
    const visibilityErr = invalidVisibilityError(raw);
    if (visibilityErr) return res.status(400).json({ error: visibilityErr });
    const turnOrderErr = invalidTurnOrderError(raw);
    if (turnOrderErr) return res.status(400).json({ error: turnOrderErr });
    const nameErr = invalidNameError(raw);
    if (nameErr) return res.status(400).json({ error: nameErr });
    const hordeSetupErr = invalidHordeSetupError(raw);
    if (hordeSetupErr) return res.status(400).json({ error: hordeSetupErr });
    const hordeStepErr = invalidHordeStepError(raw);
    if (hordeStepErr) return res.status(400).json({ error: hordeStepErr });
    const hordeUndoErr = invalidHordeUndoError(raw);
    if (hordeUndoErr) return res.status(400).json({ error: hordeUndoErr });
    const resetIdErr = invalidResetIdError(raw);
    if (resetIdErr) return res.status(400).json({ error: resetIdErr });
    const coopOutcomeErr = invalidCoopOutcomeError(raw, next);
    if (coopOutcomeErr) return res.status(400).json({ error: coopOutcomeErr });
    const hordeSeatCapErr = invalidHordeSeatCapError(raw, next);
    if (hordeSeatCapErr) return res.status(400).json({ error: hordeSeatCapErr });
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
    .set({
      state: next,
      status: next.status,
      version: next.version,
      updatedAt: next.updatedAt,
      // A transfer-host moves the host; the room browser's Friends filter
      // reads this column, so it moves in the same write.
      hostUserId: next.hostUserId ?? undefined,
    })
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

gamesRouter.post('/:code/discord', createLimiter, requireAuth, openDiscordTable);

/**
 * POST /api/games/:code/leave — leave the game. In the lobby the seat goes;
 * once started it stays, marked not connected. A host hands the table to
 * `nextHostSeat` first (E430); with nobody to hand it to, or when the last
 * account leaves, the table is deleted.
 *
 * fix: a non-participant used to get the current `GameState` back verbatim —
 * `if (!me) return res.json({ game: current })` — regardless of visibility,
 * which meant any authenticated caller who merely knew (or swept) a code
 * could read a `'private'` game's full state, deck names and all, through
 * this one route. Every other route in this file answers a non-participant
 * with the same 404 an unknown code gets (see `resolveGameAccess`'s doc on
 * why that stealth matters); this route now matches them — there is nothing
 * to leave for a caller who never held a seat, so 404 is also just correct.
 */
gamesRouter.post('/:code/leave', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const current = row.state as GameState;
  const me = current.players.find((p) => p.userId === req.user!.id);
  if (!me) return res.status(404).json({ error: 'Game not found.' });

  // E430: a host who leaves hands the table on rather than ending it for
  // everyone, then leaves like anyone else. game-core picks the successor,
  // so the Leave dialog names the same seat the server hands it to.
  const successor = me.isHost ? nextHostSeat(current) : null;
  let next =
    successor !== null ? applyAction(current, { type: 'transfer-host', seat: successor }) : current;
  next =
    current.status === 'lobby'
      ? applyAction(next, { type: 'remove-player', seat: me.seat })
      : // Mid-game or finished: keep the seat so life totals are intact.
        applyAction(next, { type: 'update-player', seat: me.seat, patch: { connected: false } });

  // Nobody with an account is left at the table (a host with no successor,
  // or the last one out): nothing can act on it any more, so it ends now
  // rather than sitting until the 24h sweep.
  if (
    (me.isHost && successor === null) ||
    !next.players.some((p) => p.userId !== null && p.connected)
  ) {
    await db.delete(gameSessions).where(eq(gameSessions.code, code));
    broadcastGameDeleted(code);
    return res.json({ deleted: true });
  }

  await db
    .update(gameSessions)
    .set({
      state: next,
      status: next.status,
      version: next.version,
      updatedAt: next.updatedAt,
      hostUserId: next.hostUserId ?? undefined,
    })
    .where(eq(gameSessions.code, code));
  broadcastGameState(code, next);
  res.json({ game: next });
});
