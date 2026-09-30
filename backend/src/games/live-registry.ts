import { areFriends } from '../friends/relations';
import { isTest } from '../route-utils';
import { releaseDiscordTable } from './discord-tables';
import type { GameState } from './state';

/**
 * Called on every committed change (`state`) and deletion (null). A hook
 * rather than an import, so a listener can depend on `sessions.ts`, which
 * imports this file. The Discord looking-for-game posts register at boot.
 */
type ChangeListener = (code: string, state: GameState | null) => void;
const changeListeners = new Set<ChangeListener>();

export function onGameChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/**
 * Real-time fanout — in-process only. `/events` (SSE) and `/poll`
 * (long-poll, for native — see games-longpoll.ts on the client) both
 * register a `Subscriber` here, keyed by code; a mutating route calls
 * `broadcastGameState` / `broadcastGameDeleted` after it commits, and every
 * subscriber for that code gets notified. An SSE subscriber writes the frame
 * to its still-open stream; a long-poll subscriber resolves its held request
 * once and is removed — see GET /:code/poll.
 *
 * ponytail: single-machine by construction — and so is the rest of the backend: the
 * Scryfall cache is SQLite on the Fly volume (`fly.toml [mounts]`), which is
 * pinned to one machine, so a second machine is not a scaling option anyone
 * can take casually. This registry, `boards`, `requests` and `lastSeen` are
 * all in-process for that reason. The one way it goes wrong silently is
 * `fly scale count 2`: that instance's subscribers would keep falling back to
 * the poll loop (laggy, not broken) while consent requests and presence would
 * split-brain. `warnIfMultiMachine` (../fly-topology.ts) makes that loud at
 * boot and every few minutes. Upgrade path, if multi-machine ever matters:
 * Postgres LISTEN/NOTIFY fan-out plus tables for boards/requests/presence.
 *
 * This and every other ceiling the table knowingly runs under — with its
 * failure mode and upgrade path — is listed in README § "Online table:
 * accepted ceilings". A limit that isn't on that ledger is a bug.
 */
export interface Subscriber {
  /** Authenticated caller this subscriber was opened by — see `broadcastGameState`'s eviction check and `isSeatPresent` below. */
  userId: string;
  /** Whether this caller was a friend of the host at subscribe time —
   *  cached so `broadcastGameState`'s per-mutation eviction check
   *  (`canReadCached`) never re-queries the friendship table. Only
   *  meaningful (and only ever set true) for a non-participant subscribed to
   *  a `'friends'`-visibility table; see `canReadCached`'s doc for the
   *  staleness tradeoff this cache makes. */
  isFriendOfHost?: boolean;
  /** True for an SSE stream (held open indefinitely), absent for a long-poll
   *  subscriber (resolves once). Only streams count against
   *  `MAX_STREAMS_PER_USER`. */
  stream?: boolean;
  onState: (state: GameState) => void;
  onDeleted: () => void;
  onBoard?: (seat: number, board: unknown) => void;
  onRequest?: (request: StoredRequest) => void;
  onSignal?: (signal: GameSignal) => void;
}
export const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Cap on concurrently-open SSE streams per user, across every code. Each
 * stream holds a socket, a 25s heartbeat timer and a subscriber entry for as
 * long as the client keeps it open, so an unbounded count is a cheap way to
 * exhaust a 2GB machine from one account. Eight is generous for real use
 * (a few tabs across a couple of devices), and leaves room for the zombies a
 * network blip leaves behind until their heartbeat write fails — those close
 * within one heartbeat interval. Over the cap the client gets a 429 rather
 * than evicting an older stream: `EventSource` reconnects on a server-side
 * end, so eviction would ping-pong between tabs, whereas a non-200 fails the
 * connection and the client drops to its poll loop.
 */
export const MAX_STREAMS_PER_USER = 8;

export function openStreamCount(userId: string): number {
  let n = 0;
  for (const subs of subscribers.values()) {
    for (const sub of subs) if (sub.stream && sub.userId === userId) n++;
  }
  return n;
}

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
 *
 * Contrast with table signals (`GameSignal`, see POST `/:code/signal` below):
 * those are NOT stored at all, not even like this. A board is worth catching
 * a late subscriber up on; a reaction emote or dice roll is a moment, not a
 * state — so signals skip this whole map/snapshot/catch-up machinery
 * entirely and just broadcast to whoever's connected right now.
 */
export const boards = new Map<string, Map<number, unknown>>();

export function boardsSnapshot(code: string): Array<{ seat: number; board: unknown }> {
  const codeBoards = boards.get(code);
  if (!codeBoards || codeBoards.size === 0) return [];
  return Array.from(codeBoards, ([seat, board]) => ({ seat, board }));
}

/**
 * Cross-seat request/response channel — the plumbing rewind consent is
 * built on (see `frontend/src/lib/playtest/rewind.ts`), now shared with the
 * "Hold — anyone respond?" priority ask (T101). A seat raises a request;
 * for `kind: 'rewind'` every other currently-connected seated player
 * approves or declines it and it resolves to approved/denied/expired. A
 * `kind: 'hold'` is different in kind, not degree: it's an announcement
 * that pauses the table socially, with **no approval machinery at all** —
 * nobody approves or declines it (see `/respond`, which 400s for a hold).
 * It resolves only by the requester's own cancel or its TTL backstop (see
 * `HOLD_TTL_MS`) — never by `isUnanimouslyApproved`, so an empty approver
 * set (nobody else at the table right now) must NOT instantly resolve it
 * the way a vacuous rewind approval would.
 *
 * Storage mirrors `boards` exactly: in-memory, per code, one entry per
 * *requester* seat (so "one pending request per seat" is the map's own
 * shape rather than a separate check, shared by both kinds), evicted with
 * the session by `broadcastGameDeleted`. Unlike `boards` — which keeps the
 * latest value per seat forever — a resolved request is deleted from this
 * map the instant it resolves (see `resolveRequest`), so this never
 * accumulates history; only genuinely pending requests are ever held.
 */
export interface StoredRequest {
  id: string;
  code: string;
  kind: 'rewind' | 'hold';
  /** rewind: `{ steps, summary }`. hold: `{ summary }` only — `steps` stays absent. */
  payload: { steps?: number; summary: string };
  requesterSeat: number;
  /** seat -> approved (true) / declined (false). Never populated for a hold. */
  approvals: Record<number, boolean>;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;
}
export const requests = new Map<string, Map<number, StoredRequest>>();
/** Kept out of `StoredRequest` so a broadcast/response JSON.stringify never has to strip it. */
export const requestTimers = new Map<string, ReturnType<typeof setTimeout>>();

// A hung request must never wedge the table — resolve it one way or another
// within a bounded window. Shortened under test so the expiry test doesn't
// sleep 60s; see POLL_TIMEOUT_MS above for the same pattern.
export const REQUEST_TTL_MS = isTest ? 200 : 60_000;
// A hold outlasts a rewind ask on purpose: "wait, I want to respond" is a
// real in-the-moment pause, not a quick consent check, so it gets a longer
// backstop than REQUEST_TTL_MS's 60s.
export const HOLD_TTL_MS = isTest ? 200 : 90_000;

export function requestsSnapshot(code: string): StoredRequest[] {
  const codeRequests = requests.get(code);
  if (!codeRequests || codeRequests.size === 0) return [];
  return Array.from(codeRequests.values());
}

/** Reaction emote set — the frontend UI lane pins this same fixed six; keep
 *  them in sync. The first four are the ones the table's keyboard map binds
 *  to 7/8/9/0 (thumbs up, thinking, wow, crying); the last two are
 *  picker-only. Order is the order they appear in the picker. */
export const SIGNAL_EMOTES = ['👍', '🤔', '😮', '😢', '🔥', '🫡'] as const;
export const SIGNAL_DICE = ['d6', 'd20', 'coin', 'first'] as const;

/**
 * Longest chat message the table accepts. This is table talk during a game
 * — "hold, I respond", "that resolves", "take 3" — not a message board, so
 * a tweet-ish cap keeps one seat from papering over the feed and bounds the
 * broadcast payload. Enforced after trimming.
 */
export const MAX_CHAT_LEN = 240;

/**
 * An ephemeral table signal — a reaction emote, a server-rolled die/coin, a
 * line of table chat, or a point at something on the table — see POST
 * `/:code/signal` below. Unlike `boards`/`requests` this is deliberately
 * NEVER stored: no map, no snapshot, no catch-up for a late or reconnecting
 * subscriber. A missed emote, roll, or point is a missed moment, not a state
 * to recover — broadcasting to whoever's currently connected is the entire
 * feature.
 *
 * Chat rides this same channel rather than getting a stored history, and
 * that IS the design: this is a manual-enforcement table where chat is the
 * talk *around* the current play ("hold on"), which is worthless five
 * minutes later and would otherwise need retention, moderation, and a
 * deletion story. Clients keep what arrives while they're connected in
 * their own in-memory ticker feed (frontend store/play.ts `onlineTicker`)
 * and lose it on reload, exactly like the rest of the table's ephemera.
 */
export interface GameSignal {
  kind: 'reaction' | 'roll' | 'chat' | 'point' | 'arrow' | 'ping';
  seat: number;
  ts: number;
  emote?: string;
  die?: (typeof SIGNAL_DICE)[number];
  value?: number;
  /** chat only: the trimmed message body, at most `MAX_CHAT_LEN` chars. */
  text?: string;
  /** point and ping only: the seat whose board is being indicated. */
  targetSeat?: number;
  /** point and ping only: the specific card on that seat's board. Absent
   *  means the point is at the seat/player as a whole; a ping always names
   *  a card, since a ping IS the card lighting up. */
  cardId?: string;
  /** arrow only: `add` draws one, `clear` removes every arrow this seat drew. */
  op?: 'add' | 'clear';
  /** arrow add only: the two ends. A missing card id means the seat as a whole. */
  fromSeat?: number;
  fromCardId?: string;
  toSeat?: number;
  toCardId?: string;
}

/**
 * Monotonic stamp for a broadcast signal.
 *
 * Every client identifies one signal by the pair (seat, ts) — that is what
 * dedupes the sender's own POST-response echo against the transport frame
 * of the same signal (frontend store/play.ts `applyServerSignal`). A bare
 * `Date.now()` breaks that identity the moment one seat produces two
 * signals inside the same millisecond: the second is indistinguishable from
 * a duplicate of the first and gets dropped client-side. Tolerable when the
 * only signals were hand-paced emotes and rolls; not tolerable for chat,
 * where the dropped frame is a message somebody typed. Nudging the stamp
 * forward keeps it a plain ascending epoch-ms number on the wire (no
 * client-side contract change) while making collisions impossible in this
 * process.
 */
let lastSignalTs = 0;
export function nextSignalTs(): number {
  const now = Date.now();
  lastSignalTs = now > lastSignalTs ? now : lastSignalTs + 1;
  return lastSignalTs;
}

export function broadcastSignal(code: string, signal: GameSignal): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  for (const sub of subs) sub.onSignal?.(signal);
}

/**
 * Presence tracking, keyed by code then userId, last touched at (ms epoch).
 * `connected` on a `GamePlayer` only flips on an explicit leave/join, so a
 * locked phone or a dropped network never clears it — that made
 * `requiredApprovers` (below) wait on seats that can never respond. This map
 * is the actual liveness signal: touched every time we see traffic from that
 * user for that code (subscriber registration on /events and /poll, /poll's
 * immediate branch, and GET /:code reads), and read by `isSeatPresent`.
 * Evicted with the rest of a code's in-memory state in
 * `broadcastGameDeleted`.
 */
const lastSeen = new Map<string, Map<string, number>>();

// Covers a long-poll's turnaround window (client re-issues only after a
// broadcast or the ~25s POLL_TIMEOUT_MS) plus a brief SSE reconnect, without
// keeping a seat "present" long after it's genuinely gone. Deliberately NOT
// test-aware (unlike POLL_TIMEOUT_MS/REQUEST_TTL_MS): no test waits out this
// TTL — absence is constructed by never touching presence at all — and a
// short test value turns slow full-suite runs into flakes (a fixture's
// presence GET aging past the TTL mid-test silently empties the approver
// set and auto-approves the request under load).
const PRESENCE_TTL_MS = 45_000;

export function touchPresence(code: string, userId: string): void {
  let codeSeen = lastSeen.get(code);
  if (!codeSeen) {
    codeSeen = new Map();
    lastSeen.set(code, codeSeen);
  }
  codeSeen.set(userId, Date.now());
}

/**
 * A seat counts as "present" if it has a live subscriber right now, or was
 * seen within `PRESENCE_TTL_MS`. A guest seat (`userId: null` — a host-added
 * local player with no device of its own) is never present: `makePlayer`
 * defaults `connected` to `true`, so without this a guest would otherwise
 * silently become a required approver that can never respond, wedging every
 * consent request for the whole table.
 */
function isSeatPresent(code: string, userId: string | null): boolean {
  if (userId === null) return false;
  const subs = subscribers.get(code);
  if (subs) {
    for (const sub of subs) {
      if (sub.userId === userId) return true;
    }
  }
  const seen = lastSeen.get(code)?.get(userId);
  return seen !== undefined && Date.now() - seen < PRESENCE_TTL_MS;
}

/**
 * The set of seats whose approval a request needs: every other seated
 * player who currently holds a connected seat AND is actually present (see
 * `isSeatPresent`). Excluding an absent seat means it can never block the
 * table forever — and if it's the last one excluded (everyone else has left
 * or gone quiet), the required set is empty and the request resolves
 * approved by construction (nothing left to ask).
 */
function requiredApprovers(code: string, state: GameState, requesterSeat: number): number[] {
  return state.players
    .filter((p) => p.seat !== requesterSeat && p.connected && isSeatPresent(code, p.userId))
    .map((p) => p.seat);
}

export function isUnanimouslyApproved(code: string, state: GameState, req: StoredRequest): boolean {
  return requiredApprovers(code, state, req.requesterSeat).every(
    (seat) => req.approvals[seat] === true
  );
}

/**
 * Fans out fresh state to every subscriber for this code — except one whose
 * `userId` the new state no longer counts as a participant. That's the
 * host-only `remove-player` case: without this, a kicked player's still-open
 * SSE stream kept receiving every future frame because `/events` only
 * checks `isParticipant` once, at connect. Evicting here (rather than only
 * at connect) ends that stream immediately — `onDeleted` — instead of
 * quietly serving a removed player the game forever.
 */
export function broadcastGameState(code: string, state: GameState): void {
  // Ahead of the early return: a listener cares about every change, watched
  // or not.
  for (const fn of changeListeners) fn(code, state);
  const subs = subscribers.get(code);
  if (!subs || subs.size === 0) return;
  for (const sub of Array.from(subs)) {
    if (!canReadCached(state, sub)) {
      subs.delete(sub);
      sub.onDeleted();
      continue;
    }
    sub.onState(state);
  }
  if (subs.size === 0) subscribers.delete(code);
}

export function broadcastBoard(code: string, seat: number, board: unknown): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  for (const sub of subs) sub.onBoard?.(seat, board);
}

export function broadcastRequest(code: string, request: StoredRequest): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  for (const sub of subs) sub.onRequest?.(request);
}

/**
 * Terminal transition for a request — status flip, timer teardown, removal
 * from `requests` (so a resolved request is never served to a late
 * subscriber — see `requestsSnapshot`), and a broadcast of the final state.
 * Guarded against double-resolution: a response and the expiry timer can
 * both fire for the same request (the response arriving right as the timer
 * ticks), and only the first should count.
 */
export function resolveRequest(
  code: string,
  req: StoredRequest,
  status: StoredRequest['status']
): void {
  if (req.status !== 'pending') return;
  req.status = status;
  const timer = requestTimers.get(req.id);
  if (timer) {
    clearTimeout(timer);
    requestTimers.delete(req.id);
  }
  const codeRequests = requests.get(code);
  if (codeRequests) {
    codeRequests.delete(req.requesterSeat);
    if (codeRequests.size === 0) requests.delete(code);
  }
  broadcastRequest(code, req);
}

/** Notifies every subscriber for a deleted session so clients notice immediately. */
export function broadcastGameDeleted(code: string): void {
  releaseDiscordTable(code);
  for (const fn of changeListeners) fn(code, null);
  const subs = subscribers.get(code);
  if (subs) {
    for (const sub of subs) sub.onDeleted();
    subscribers.delete(code);
  }
  boards.delete(code);
  const codeRequests = requests.get(code);
  if (codeRequests) {
    for (const req of codeRequests.values()) {
      const timer = requestTimers.get(req.id);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(req.id);
      }
    }
    requests.delete(code);
  }
  lastSeen.delete(code);
}

export function addSubscriber(code: string, sub: Subscriber): void {
  let subs = subscribers.get(code);
  if (!subs) {
    subs = new Set();
    subscribers.set(code, subs);
  }
  subs.add(sub);
}

export function removeSubscriber(code: string, sub: Subscriber): void {
  const subs = subscribers.get(code);
  if (!subs) return;
  subs.delete(sub);
  if (subs.size === 0) subscribers.delete(code);
}

export function isParticipant(state: GameState, userId: string): boolean {
  if (state.hostUserId === userId) return true;
  return state.players.some((p) => p.userId === userId);
}

/**
 * Whether `userId` is friends with this game's host. `null`/absent host
 * (never true for an online game, only the type allows it) reads as no.
 * The ONE friendship check every friends-gated route goes through — see
 * `resolveGameAccess` and `canReadCached` below — so "friend of the host"
 * can never mean something different in one route than another.
 */
async function isFriendOfHost(state: GameState, userId: string): Promise<boolean> {
  return state.hostUserId != null && (await areFriends(userId, state.hostUserId));
}

/**
 * Who may READ this game WITHOUT the code — GET /:code, /events, /poll, and
 * the room browser — resolved in one place so those routes can't drift
 * apart. `visibility` is monotone: **Public ⊇ Friends ⊇ Private**. Each rung
 * only ever ADDS readers on top of the one below it; it never takes away
 * what a lower rung already grants:
 *
 *   - `'private'`: participants only, no code-free discovery at all.
 *   - `'friends'`: participants, plus the host's own friends.
 *   - `'public'`: participants, plus anyone.
 *
 * Holding the 4-char join code is a SEPARATE, orthogonal grant that exists at
 * every rung equally — see `POST /:code/join`, which never calls this
 * function and never gates on visibility at all. A friends-only host can
 * still hand the code to a stranger to seat them; visibility only decides who
 * can find or watch the table without ever being given it. That is also why
 * this predicate matters: a join code is four characters, about a million of
 * them, which is why a denial here is the same 404 an unknown code gets
 * rather than anything that would let a sweep distinguish "exists but is
 * private" from "no such code".
 *
 * `isFriendOfHost` rides along on the result so a caller that's about to open
 * a live subscriber (SSE/poll) can cache it on the `Subscriber` — see
 * `canReadCached` — rather than re-querying the friendship table on every
 * broadcast for the lifetime of the connection.
 *
 * Reading is all `'friends'`/`'public'` access grants. Every mutation still
 * goes through `isParticipant` (`actionIsAllowed`), so a friend watching a
 * `'friends'` table — like a `'public'` spectator — can watch and do nothing
 * else, and what they see is what each seat chose to publish.
 */
export async function resolveGameAccess(
  state: GameState,
  userId: string
): Promise<{ allowed: boolean; isFriendOfHost: boolean }> {
  if (isParticipant(state, userId)) return { allowed: true, isFriendOfHost: false };
  if (state.visibility === 'public') return { allowed: true, isFriendOfHost: false };
  if (state.visibility === 'friends') {
    const friend = await isFriendOfHost(state, userId);
    return { allowed: friend, isFriendOfHost: friend };
  }
  return { allowed: false, isFriendOfHost: false };
}

/**
 * Sync counterpart to `resolveGameAccess`, for the one caller that can't
 * await a friendship query per check: `broadcastGameState` re-evaluates every
 * open subscriber on every mutation. Trusts the subscriber's own cached
 * `isFriendOfHost` (set once, when it subscribed — see `GET /:code/events`
 * and `/:code/poll`) rather than re-querying live.
 *
 * ponytail: this means a host's friend who un-friends them mid-stream keeps
 * watching until they reconnect (their next `/events`/`/poll` open re-checks
 * live and would then 404 them) — a real but narrow staleness window, not a
 * standing hole: `GET /:code` and `POST /:code/join` always check live, so
 * the game is never joinable or re-openable by an ex-friend. Upgrade path if
 * this ever matters: re-check `isFriendOfHost` on a timer instead of at
 * subscribe time, same tradeoff `PRESENCE_TTL_MS` already makes elsewhere in
 * this file.
 */
function canReadCached(state: GameState, sub: Subscriber): boolean {
  if (isParticipant(state, sub.userId)) return true;
  if (state.visibility === 'public') return true;
  return state.visibility === 'friends' && sub.isFriendOfHost === true;
}
