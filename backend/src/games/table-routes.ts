import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { gameSessions } from '../db/schema';
import { testAwareLimiter } from '../route-utils';
import {
  HOLD_TTL_MS,
  MAX_CHAT_LEN,
  REQUEST_TTL_MS,
  SIGNAL_DICE,
  SIGNAL_EMOTES,
  boards,
  broadcastBoard,
  broadcastRequest,
  broadcastSignal,
  isUnanimouslyApproved,
  nextSignalTs,
  requestTimers,
  requests,
  resolveRequest,
  touchPresence,
  type GameSignal,
  type StoredRequest,
} from './live-registry';
import type { GameState } from './state';

/** POST /:code/board, /signal, /request, /request/:id/respond, /request/:id/cancel. Mounted by routes/games.ts at the position these routes always held. */
export const tableRouter: Router = Router();

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
  if (
    !(['battlefield', 'graveyard', 'exile', 'command'] as const).every((zone) =>
      Array.isArray(b[zone])
    )
  ) {
    return false;
  }
  // Battlefield positions are fractions of the board (`--pt-x`/`--pt-y` in
  // 0..1, see PlaytestCardView). Anything else is a tampered client, and an
  // out-of-range value would render an opponent's card off their board or
  // stretch the modal's scroll container to reach it.
  const inRange = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
  return (b.battlefield as unknown[]).every(
    (bf) =>
      typeof bf === 'object' &&
      bf !== null &&
      inRange((bf as { x?: unknown }).x) &&
      inRange((bf as { y?: unknown }).y)
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
tableRouter.post('/:code/board', boardLimiter, requireAuth, async (req: Request, res: Response) => {
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

// Emotes/rolls/points are bursty (a flurry after a big play) but still
// human-paced, and chat is the one signal a player produces in a sustained
// run rather than a burst — a heated four-player rules discussion is easily
// a message every few seconds from several seats at once. Raised from the
// emote-only budget of 60 to cover that without a legitimate table ever
// tripping it, and still well below writeLimiter's per-move budget.
const signalLimiter = testAwareLimiter({ windowMs: 60_000, max: 180 });

/**
 * POST /api/games/:code/signal — broadcast an ephemeral table signal: a
 * reaction emote, or a server-rolled die/coin/seat. Security shape mirrors
 * `/board` and `/request` exactly: stealth 404 for a non-participant, seat
 * always derived server-side (there is no seat field in the body to spoof).
 *
 * Body is strictly whitelisted by `kind`: `'reaction'` requires `emote` to be
 * one of the fixed `SIGNAL_EMOTES`; `'roll'` requires `die` to be one of
 * `SIGNAL_DICE`; `'chat'` requires a `text` that is non-empty after trimming
 * and at most `MAX_CHAT_LEN`; `'point'` requires a `targetSeat` that is
 * actually seated in THIS game, with an optional `cardId`; `'ping'` is the
 * same but its `cardId` is required. Anything else
 * (including a well-formed body for another kind) is a 400. The response
 * signal is built field-by-field from known values — never a spread of the
 * request body — so a stray extra field can never ride along into the
 * broadcast.
 *
 * A roll's `value` is generated here, server-side, so every seat sees the
 * same result: 1-6 for d6, 1-20 for d20, 0|1 for a coin, and for `'first'` —
 * "who goes first" — a uniformly random SEAT NUMBER drawn from the game's
 * current players (clients resolve the seat to a name).
 *
 * A point's `cardId` is passed through UNVALIDATED against any board, on
 * purpose. Board state lives in the ephemeral `boards` map that a seat may
 * not have published into yet, and a card can legitimately leave a zone in
 * the moment between the point and its delivery — so the server would be
 * rejecting valid points to enforce a consistency it cannot actually
 * guarantee. It is only ever an opaque render key: receivers highlight a
 * card whose id matches on the target seat's board and otherwise fall back
 * to pointing at the seat, so an id matching nothing degrades to a
 * whole-seat point rather than an error. It is length-capped because it is
 * attacker-controlled text that gets broadcast, and `targetSeat` IS checked
 * against the roster because a point at a seat nobody occupies has no
 * sensible rendering at all.
 */
tableRouter.post(
  '/:code/signal',
  signalLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const db = getDb();
    const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Game not found.' });
    const state = row.state as GameState;
    // Stealth 404, byte-identical to an unknown code — see the long comment on
    // POST /:code/board / GET /:code for why (4-char codes, ~1M of them).
    const me = state.players.find((p) => p.userId === req.user!.id);
    if (!me) return res.status(404).json({ error: 'Game not found.' });

    const body = req.body as {
      kind?: unknown;
      emote?: unknown;
      die?: unknown;
      text?: unknown;
      targetSeat?: unknown;
      cardId?: unknown;
      op?: unknown;
      fromSeat?: unknown;
      fromCardId?: unknown;
      toSeat?: unknown;
      toCardId?: unknown;
    };
    let signal: GameSignal;
    if (body.kind === 'reaction') {
      const emote = body.emote;
      if (typeof emote !== 'string' || !(SIGNAL_EMOTES as readonly string[]).includes(emote)) {
        return res.status(400).json({ error: 'Invalid emote.' });
      }
      signal = { kind: 'reaction', seat: me.seat, ts: nextSignalTs(), emote };
    } else if (body.kind === 'chat') {
      const raw = body.text;
      if (typeof raw !== 'string') return res.status(400).json({ error: 'Invalid message.' });
      const text = raw.trim();
      if (text.length === 0 || text.length > MAX_CHAT_LEN) {
        return res.status(400).json({ error: 'Invalid message.' });
      }
      signal = { kind: 'chat', seat: me.seat, ts: nextSignalTs(), text };
    } else if (body.kind === 'point') {
      const targetSeat = body.targetSeat;
      if (
        typeof targetSeat !== 'number' ||
        !Number.isInteger(targetSeat) ||
        !state.players.some((p) => p.seat === targetSeat)
      ) {
        return res.status(400).json({ error: 'Invalid target seat.' });
      }
      const rawCardId = body.cardId;
      if (rawCardId !== undefined && (typeof rawCardId !== 'string' || rawCardId.length > 128)) {
        return res.status(400).json({ error: 'Invalid card.' });
      }
      const cardId = typeof rawCardId === 'string' && rawCardId.length > 0 ? rawCardId : undefined;
      signal = {
        kind: 'point',
        seat: me.seat,
        ts: nextSignalTs(),
        targetSeat,
        ...(cardId !== undefined && { cardId }),
      };
    } else if (body.kind === 'ping') {
      // A ping is a point's quieter sibling: the same two fields, the same
      // opaque-card-id trust boundary, but it renders as a ring around the
      // card for about a second and writes NOTHING to the play ticker.
      // That difference is the whole reason it is its own kind — a ping
      // fires on an ordinary card tap, so routing it through `point` would
      // bury the table's feed under "is pointing at" lines nobody asked for.
      const targetSeat = body.targetSeat;
      if (
        typeof targetSeat !== 'number' ||
        !Number.isInteger(targetSeat) ||
        !state.players.some((p) => p.seat === targetSeat)
      ) {
        return res.status(400).json({ error: 'Invalid target seat.' });
      }
      const rawCardId = body.cardId;
      if (typeof rawCardId !== 'string' || rawCardId.length === 0 || rawCardId.length > 128) {
        return res.status(400).json({ error: 'Invalid card.' });
      }
      signal = {
        kind: 'ping',
        seat: me.seat,
        ts: nextSignalTs(),
        targetSeat,
        cardId: rawCardId,
      };
    } else if (body.kind === 'arrow') {
      // An arrow is a point that stays: two ends, either end a seat or a card
      // on that seat's board. Same trust boundary as `point` — seats are
      // checked against the roster, card ids are opaque, length-capped render
      // keys a receiver degrades to the seat when nothing matches. `clear`
      // carries nothing else: it removes every arrow THIS seat drew.
      if (body.op === 'clear') {
        signal = { kind: 'arrow', seat: me.seat, ts: nextSignalTs(), op: 'clear' };
      } else if (body.op === 'add') {
        const seated = (s: unknown): s is number =>
          typeof s === 'number' && Number.isInteger(s) && state.players.some((p) => p.seat === s);
        if (!seated(body.fromSeat) || !seated(body.toSeat)) {
          return res.status(400).json({ error: 'Invalid arrow seat.' });
        }
        const cardOk = (c: unknown) =>
          c === undefined || (typeof c === 'string' && c.length <= 128);
        if (!cardOk(body.fromCardId) || !cardOk(body.toCardId)) {
          return res.status(400).json({ error: 'Invalid card.' });
        }
        const fromCardId =
          typeof body.fromCardId === 'string' && body.fromCardId.length > 0
            ? body.fromCardId
            : undefined;
        const toCardId =
          typeof body.toCardId === 'string' && body.toCardId.length > 0 ? body.toCardId : undefined;
        signal = {
          kind: 'arrow',
          seat: me.seat,
          ts: nextSignalTs(),
          op: 'add',
          fromSeat: body.fromSeat,
          toSeat: body.toSeat,
          ...(fromCardId !== undefined && { fromCardId }),
          ...(toCardId !== undefined && { toCardId }),
        };
      } else {
        return res.status(400).json({ error: 'Invalid arrow.' });
      }
    } else if (body.kind === 'roll') {
      const die = body.die;
      if (typeof die !== 'string' || !(SIGNAL_DICE as readonly string[]).includes(die)) {
        return res.status(400).json({ error: 'Invalid die.' });
      }
      const value =
        die === 'd6'
          ? crypto.randomInt(1, 7)
          : die === 'd20'
            ? crypto.randomInt(1, 21)
            : die === 'coin'
              ? crypto.randomInt(0, 2)
              : state.players[crypto.randomInt(state.players.length)].seat;
      signal = {
        kind: 'roll',
        seat: me.seat,
        ts: nextSignalTs(),
        die: die as GameSignal['die'],
        value,
      };
    } else {
      return res.status(400).json({ error: 'Unsupported signal kind.' });
    }

    // Sending a signal is proof of presence, same as /board and the poll GETs.
    touchPresence(code, req.user!.id);
    broadcastSignal(code, signal);
    res.json({ signal });
  }
);

// Raising/responding to a request is a rare, human-paced action (a handful
// per game at most), nowhere near board's per-move cadence — sized well
// below writeLimiter accordingly.
const requestLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

/** A request payload is tiny (a step count + a one-line summary); this is generous but bounded. */
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_SUMMARY_LEN = 200;

/** `kind: 'rewind'` payload shape — see the module doc comment above `requests`. */
function isPlausibleRewindPayload(body: unknown): body is { steps: number; summary: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (!Number.isFinite(b.steps) || (b.steps as number) <= 0 || (b.steps as number) > 50)
    return false;
  if (typeof b.summary !== 'string' || b.summary.trim().length === 0) return false;
  return true;
}

/** `kind: 'hold'` payload shape — just an object; `summary` is optional (see `holdSummary`). */
function isPlausibleHoldPayload(body: unknown): body is { summary?: unknown } {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/**
 * A hold's summary defaults to a stock announcement rather than 400ing on
 * empty — this is a one-tap "wait, I respond" social nudge, not a form, so
 * requiring text would add friction to the exact moment it's least wanted.
 */
function holdSummary(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim().slice(0, MAX_SUMMARY_LEN) : '';
  return trimmed.length > 0 ? trimmed : 'wants to respond';
}

/**
 * POST /api/games/:code/request — raise a cross-seat request: rewind
 * consent (`kind: 'rewind'`, see `frontend/src/lib/playtest/rewind.ts`) or
 * a "Hold — anyone respond?" priority ask (`kind: 'hold'`, T101). Security
 * shape mirrors `/board` exactly: stealth 404 for a non-participant, seat
 * derived server-side, payload capped and structurally validated.
 *
 * Only one pending request per requester seat, for either kind: the
 * `requests` map is keyed by requester seat (see its doc comment), so a
 * second raise while one is still pending is rejected with 409 rather than
 * silently replacing it — simpler than replacing, and it avoids the
 * question of what happens to votes already cast against the request being
 * displaced.
 *
 * A rewind with nobody else currently a connected seated player resolves
 * approved immediately (see `requiredApprovers` — an empty required set is
 * vacuously unanimous) rather than sitting pending for 60s with nothing
 * that could ever approve it. A hold NEVER takes this path, even with an
 * empty approver set — see the module doc comment on `StoredRequest` for
 * why a hold has no approval machinery at all.
 */
tableRouter.post(
  '/:code/request',
  requestLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const db = getDb();
    const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Game not found.' });
    const state = row.state as GameState;
    // Stealth 404, byte-identical to an unknown code — see the long comment on
    // POST /:code/board / GET /:code for why (4-char codes, ~1M of them).
    const me = state.players.find((p) => p.userId === req.user!.id);
    if (!me) return res.status(404).json({ error: 'Game not found.' });

    const body = req.body as { kind?: unknown; payload?: unknown };
    if (body.kind !== 'rewind' && body.kind !== 'hold') {
      return res.status(400).json({ error: 'Unsupported request kind.' });
    }
    if (JSON.stringify(body.payload ?? {}).length > MAX_REQUEST_BYTES) {
      return res.status(413).json({ error: 'Request payload too large.' });
    }

    let codeRequests = requests.get(code);
    if (codeRequests?.has(me.seat)) {
      return res.status(409).json({ error: 'A request is already pending for this seat.' });
    }
    if (!codeRequests) {
      codeRequests = new Map();
      requests.set(code, codeRequests);
    }

    const now = Date.now();
    let storedRequest: StoredRequest;
    if (body.kind === 'rewind') {
      if (!isPlausibleRewindPayload(body.payload)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      storedRequest = {
        id: crypto.randomUUID(),
        code,
        kind: 'rewind',
        payload: {
          steps: Math.floor(body.payload.steps),
          summary: body.payload.summary.trim().slice(0, MAX_SUMMARY_LEN),
        },
        requesterSeat: me.seat,
        approvals: {},
        status: 'pending',
        createdAt: now,
        expiresAt: now + REQUEST_TTL_MS,
      };
    } else {
      if (!isPlausibleHoldPayload(body.payload)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      storedRequest = {
        id: crypto.randomUUID(),
        code,
        kind: 'hold',
        payload: { summary: holdSummary(body.payload.summary) },
        requesterSeat: me.seat,
        approvals: {},
        status: 'pending',
        createdAt: now,
        expiresAt: now + HOLD_TTL_MS,
      };
    }
    codeRequests.set(me.seat, storedRequest);
    requestTimers.set(
      storedRequest.id,
      setTimeout(
        () => resolveRequest(code, storedRequest, 'expired'),
        storedRequest.kind === 'hold' ? HOLD_TTL_MS : REQUEST_TTL_MS
      )
    );

    // A hold NEVER auto-approves — even with an empty required-approver set,
    // which would otherwise read as vacuously unanimous the way a rewind
    // does. See the module doc comment on `StoredRequest`.
    if (storedRequest.kind === 'rewind' && isUnanimouslyApproved(code, state, storedRequest)) {
      resolveRequest(code, storedRequest, 'approved');
    } else {
      broadcastRequest(code, storedRequest);
    }
    res.status(201).json({ request: storedRequest });
  }
);

/**
 * POST /api/games/:code/request/:id/respond — approve or decline a pending
 * `kind: 'rewind'` request. Body: `{ approve: boolean }`. The responding
 * seat is derived server-side from the authenticated caller's participant
 * record, exactly like `/board` and `/request` — there's no seat field in
 * the body for a caller to spoof, so "a seat cannot respond on another
 * seat's behalf" holds by construction, not by a runtime check.
 *
 * `kind: 'hold'` requests 400 here — a hold has no approval machinery (see
 * the module doc comment on `StoredRequest`); it resolves only via cancel
 * or its TTL.
 *
 * One decline resolves the request denied immediately, without waiting on
 * anyone else. Unanimous approval from `requiredApprovers` resolves it
 * approved. Neither the requester approving their own request, nor
 * responding twice / after resolution, is allowed.
 */
tableRouter.post(
  '/:code/request/:id/respond',
  requestLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const db = getDb();
    const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Game not found.' });
    const state = row.state as GameState;
    const me = state.players.find((p) => p.userId === req.user!.id);
    if (!me) return res.status(404).json({ error: 'Game not found.' });

    const codeRequests = requests.get(code);
    const found = Array.from(codeRequests?.values() ?? []).find((r) => r.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Request not found.' });
    if (found.requesterSeat === me.seat) {
      return res.status(403).json({ error: 'Cannot respond to your own request.' });
    }
    // A hold has no approval machinery at all — see the module doc comment
    // on `StoredRequest`. It resolves only by the requester's own cancel or
    // its TTL, never by another seat's response.
    if (found.kind === 'hold') {
      return res.status(400).json({ error: 'Holds are not approved or declined.' });
    }

    const body = req.body as { approve?: unknown };
    if (typeof body.approve !== 'boolean') {
      return res.status(400).json({ error: 'approve must be a boolean.' });
    }

    // The expiry timer resolves this asynchronously; a response arriving in
    // the same tick it fires (or just after) can still see 'pending' if it
    // raced ahead of the timer callback, so re-check defensively.
    if (found.status !== 'pending' || Date.now() >= found.expiresAt) {
      resolveRequest(code, found, 'expired');
      return res.status(409).json({ error: 'Request already resolved.', request: found });
    }

    found.approvals[me.seat] = body.approve;
    if (!body.approve) {
      resolveRequest(code, found, 'denied');
    } else if (isUnanimouslyApproved(code, state, found)) {
      resolveRequest(code, found, 'approved');
    } else {
      broadcastRequest(code, found);
    }
    res.json({ request: found });
  }
);

/**
 * POST /api/games/:code/request/:id/cancel — withdraw a still-pending
 * request, either kind. Requester-only (the seat that raised it); anyone
 * else gets 403, matching /respond's shape for an invalid-but-authenticated
 * actor. This is a hold's ONLY requester-driven resolution path (the other
 * being its TTL) — the wire status is `'cancelled'` for both kinds; a
 * cancelled hold just reads as "released" in the UI.
 */
tableRouter.post(
  '/:code/request/:id/cancel',
  requestLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const db = getDb();
    const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Game not found.' });
    const state = row.state as GameState;
    const me = state.players.find((p) => p.userId === req.user!.id);
    if (!me) return res.status(404).json({ error: 'Game not found.' });

    const codeRequests = requests.get(code);
    const found = Array.from(codeRequests?.values() ?? []).find((r) => r.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Request not found.' });
    if (found.requesterSeat !== me.seat) {
      return res.status(403).json({ error: 'Can only cancel your own request.' });
    }
    if (found.status !== 'pending') {
      return res.status(409).json({ error: 'Request already resolved.', request: found });
    }

    resolveRequest(code, found, 'cancelled');
    res.json({ request: found });
  }
);
