import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { gameSessions } from '../db/schema';
import { isTest } from '../route-utils';
import { readLimiter } from './limiters';
import {
  MAX_STREAMS_PER_USER,
  addSubscriber,
  boardsSnapshot,
  openStreamCount,
  removeSubscriber,
  requestsSnapshot,
  resolveGameAccess,
  touchPresence,
  type Subscriber,
} from './live-registry';
import type { GameState } from './state';

/** GET /:code/events (SSE) and GET /:code/poll (long-poll). Mounted by routes/games.ts at the position these routes always held. */
export const streamRouter: Router = Router();

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
streamRouter.get('/:code/events', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  const { allowed, isFriendOfHost: friendOfHost } = await resolveGameAccess(state, req.user!.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  if (openStreamCount(req.user!.id) >= MAX_STREAMS_PER_USER) {
    return res.status(429).json({ error: 'Too many open streams for this account.' });
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
  // Same catch-up for any pending request — a subscriber connecting mid-vote
  // must see it, not just whoever was already there when it was raised.
  for (const entry of requestsSnapshot(code)) {
    res.write(`event: request\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  // A failed write on this response must never reach the process as an
  // unhandled 'error' event. `server.ts` now installs an `uncaughtException`
  // handler that logs and stays up, so this is no longer the difference
  // between a dropped connection and a dead server — but that net exists to
  // make bugs LOUD, not to own them. This listener is still the fix: it keeps
  // one client's failed write from ever leaving this connection.
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
    userId: req.user!.id,
    isFriendOfHost: friendOfHost,
    stream: true,
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
    // Same guard as onBoard above, same reason — a write landing in the
    // onDeleted -> res.end() window must not throw write-after-end.
    onRequest: (request) => {
      if (!res.writableEnded) {
        res.write(`event: request\ndata: ${JSON.stringify(request)}\n\n`);
      }
    },
    // Same guard, same reason — and no catch-up loop to pair with it (unlike
    // onBoard/onRequest above): signals are ephemeral by design, see the
    // `GameSignal` doc comment.
    onSignal: (signal) => {
      if (!res.writableEnded) {
        res.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`);
      }
    },
  };
  addSubscriber(code, sub);
  touchPresence(code, req.user!.id);

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
 * that can't use SSE (a cross-origin build — see games-longpoll.ts's client-side
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
 * Every branch of this route's response — immediate, state-broadcast,
 * board-resolved, request-resolved, and the `{ unchanged: true }` timeout —
 * carries the code's current `boards` and `requests` snapshots, not just
 * whichever single item resolved the poll (`board`/`request` stay on the
 * board/request branches too, for compatibility). A held poll only ever
 * settles on the FIRST thing that happens to it, so without the full
 * snapshots on every branch, anything else broadcast in the same window —
 * a second board publish, or a consent request with no other re-delivery
 * path at all — would be silently lost until the client's *next* poll
 * happened to carry it. The frontend's long-poll loop already applies
 * `boards`/`requests` unconditionally on every response, so this needed no
 * client-side change.
 *
 * Every branch that can end the request (immediate reply, broadcast,
 * deletion, timeout, client disconnect) funnels through `settle`, which is
 * idempotent — guards a timeout and a broadcast racing to resolve the same
 * request, which would otherwise attempt two responses and throw. The
 * timeout and the subscriber registration are always torn down together so
 * a resolved or abandoned request never lingers (load-bearing on a 2GB VM
 * with many concurrently-held long-polls).
 */
streamRouter.get('/:code/poll', readLimiter, requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const db = getDb();
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.code, code)).limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const state = row.state as GameState;
  const { allowed, isFriendOfHost: friendOfHost } = await resolveGameAccess(state, req.user!.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Game not found.' });
  }

  const rawSince = Number(req.query.since);
  const since = Number.isFinite(rawSince) ? rawSince : -1;
  const catchUp = req.query.catchUp === '1';
  if (state.version > since || catchUp) {
    // Immediate branch never registers a subscriber, so it's the one place
    // this route must touch presence itself.
    touchPresence(code, req.user!.id);
    return res.json({
      game: state,
      boards: boardsSnapshot(code),
      requests: requestsSnapshot(code),
    });
  }

  let settled = false;
  // Every branch that can resolve a held poll carries the current
  // boards/requests snapshots, not just the state-broadcast branch — a
  // board or request published while the poll is held otherwise had no
  // re-delivery path (the request case had none at all), so a native seat
  // could miss an ask and let it expire denied. The single-item `board`/
  // `request` fields stay for compatibility with the frontend's existing
  // fast path; the arrays are what let the long-poll loop self-heal from
  // any lost frame on its very next tick.
  const timer = setTimeout(
    () =>
      settle(() =>
        res.json({
          unchanged: true,
          boards: boardsSnapshot(code),
          requests: requestsSnapshot(code),
        })
      ),
    POLL_TIMEOUT_MS
  );
  const sub: Subscriber = {
    userId: req.user!.id,
    isFriendOfHost: friendOfHost,
    onState: (fresh) =>
      settle(() =>
        res.json({ game: fresh, boards: boardsSnapshot(code), requests: requestsSnapshot(code) })
      ),
    onDeleted: () => settle(() => res.status(404).json({ error: 'Game not found.' })),
    onBoard: (seat, board) =>
      settle(() =>
        res.json({
          board: { seat, board },
          boards: boardsSnapshot(code),
          requests: requestsSnapshot(code),
        })
      ),
    onRequest: (request) =>
      settle(() =>
        res.json({ request, boards: boardsSnapshot(code), requests: requestsSnapshot(code) })
      ),
    // Same snapshots-on-every-branch convention as onBoard/onRequest above —
    // see the long comment on this route for why. No signal history/replay
    // exists to catch up on (see the `GameSignal` doc comment); this only
    // carries the ONE signal that resolved this particular held poll.
    onSignal: (signal) =>
      settle(() =>
        res.json({ signal, boards: boardsSnapshot(code), requests: requestsSnapshot(code) })
      ),
  };

  function settle(respond: () => void): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    removeSubscriber(code, sub);
    respond();
  }

  addSubscriber(code, sub);
  touchPresence(code, req.user!.id);
  req.on('close', () => settle(() => {}));
});
