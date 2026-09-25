import { logger } from '@/lib/logger';
import { create } from 'zustand';
import { genId } from '../lib/id';
import { track } from '../lib/analytics';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  applyAction,
  createGameState,
  gameToRecord,
  makePlayer,
  normalizeCounterName,
  type GameAction,
  type GameFormat,
  type GamePlayer,
  type GameRecord,
  type GameState,
} from '../lib/game-state';
import {
  createGame as apiCreateGame,
  getGame as apiGetGame,
  joinGame as apiJoinGame,
  leaveGame as apiLeaveGame,
  patchGame as apiPatchGame,
  raiseGameRequest as apiRaiseGameRequest,
  respondGameRequest as apiRespondGameRequest,
  cancelGameRequest as apiCancelGameRequest,
  sendGameSignal as apiSendGameSignal,
  type CreateGameInput,
  type GameRequest,
  type GameSignal,
  type GameSignalInput,
  type JoinGameInput,
} from '../lib/games-api';
import { subscribeGameEvents } from '../lib/games-sse';
import { subscribeGameLongPoll, usesLongPoll } from '../lib/games-longpoll';
import { cancelBoardPublish } from '../lib/games-board';
import { setHapticsEnabled } from '../lib/haptics';
import { clearUndo } from '../lib/undo-stack';
import { applyEditToRecord, applyEditToState } from '../lib/edit-game-record';
import { FORMAT_OPTIONS } from '../lib/game-formats';
import type { PublicBoard, TickerEntry } from '../lib/playtest/projection';
import {
  deleteGameResult,
  patchGameResult,
  setGameResultHidden,
  type GameResultEdit,
  fetchMyResults,
  postLocalResult,
  resultToRecord,
} from '../lib/game-results-client';
import { useAuth } from './auth';
import { toast } from './toasts';

import { userMessage } from '@/lib/user-error';
const POLL_INTERVAL_MS = 2500;

export interface LocalGameSetup {
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  /** Which way seats are arranged around the table. Optional — a setup built
   *  before this field existed (an old saved table profile) omits it, and
   *  `createGameState` reads that the same as an explicit `'clockwise'`. */
  turnOrder?: 'clockwise' | 'counterclockwise';
  players: Array<{
    name: string;
    /**
     * The account in this seat — you, or a friend — so the finished game
     * credits their record (see `flushPendingResults`). Absent or null is a
     * guest: a named seat with no account, which is most seats at most
     * tables. Optional because this is an input draft and every caller
     * predating the field keeps working.
     */
    userId?: string | null;
    /** The account's handle, kept beside `name` so a profile or rematch can
     *  re-resolve the seat if the display name has changed since. */
    username?: string | null;
    deckId: string | null;
    deckName: string | null;
    commander: string | null;
    /**
     * Second commander for a Partner pair. Optional because this is an input
     * draft, not stored state: a guest seat or a seat that never picked a deck
     * just omits it, and `makePlayer` normalizes the absence to null.
     */
    partner?: string | null;
    colorIdentity: string[];
  }>;
  /**
   * Free-form counter names every seat starts with, at zero — a pod that
   * always tracks energy shouldn't create it by hand each game. Optional
   * because this is an input draft: absent means "no counters", the same as
   * an empty list, and every caller predating the field keeps working.
   */
  counters?: string[];
}

/**
 * A named, reloadable table setup.
 *
 * Saving is EXPLICIT and loading is a genuine reset — the whole form is
 * replaced by the profile. The obvious-looking alternative, auto-saving the
 * live setup back into its profile, is the trap: it makes "load my profile"
 * stop being a way to get a clean slate, which is the main reason anyone
 * reaches for one.
 */
export interface TableProfile {
  id: string;
  name: string;
  /** When it was last saved — shown so an old profile is recognisable as old. */
  savedAt: number;
  setup: LocalGameSetup;
}

/** Longest a profile name may be; it renders in a one-line list row. */
export const MAX_PROFILE_NAME_LENGTH = 40;

/**
 * One seat handed to the local setup form by a game night's "Start game":
 * the RSVP's display name, plus the handle when the RSVP is account-backed so
 * the form can seat the account (and credit it) rather than just the name.
 */
export interface SeatSeed {
  name: string;
  username?: string | null;
}

/** Minimal shape needed to re-seed a game from a finished one. */
export interface RematchTemplate {
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  /** Which way this table seats. Turn order is a fact about how the people
   *  at the table are sitting, not the device, so Rematch carries it forward
   *  the same as format/startingLife — a counterclockwise table stays
   *  counterclockwise. Optional: `recordToRematch` (below) has no source for
   *  it and leaves it unset, which reads as clockwise. */
  turnOrder?: 'clockwise' | 'counterclockwise';
  players: LocalGameSetup['players'];
}

/** Derive a rematch template from a finished in-memory game. */
export function gameToRematch(game: GameState): RematchTemplate {
  return {
    format: game.format,
    startingLife: game.startingLife,
    commanderDamageEnabled: game.commanderDamageEnabled,
    poisonEnabled: game.poisonEnabled,
    turnOrder: game.turnOrder,
    players: game.players.map((p) => ({
      name: p.name,
      userId: p.userId,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      partner: p.partner,
      colorIdentity: p.colorIdentity,
    })),
  };
}

/** Derive a rematch template from a persisted history record. */
export function recordToRematch(rec: GameRecord): RematchTemplate {
  return {
    format: rec.format,
    startingLife: rec.startingLife,
    // Records don't store the rule toggles; infer cmdr damage from format and
    // leave poison off (the host can flip it in the game menu if needed).
    commanderDamageEnabled: rec.format === 'commander',
    poisonEnabled: false,
    // GameRecord doesn't persist turnOrder either (it's presentation, not a
    // rule the history table tracks) — a rematch from history starts
    // clockwise; the host can flip it again in a fresh setup if needed.
    turnOrder: undefined,
    players: rec.players.map((p) => ({
      name: p.name,
      userId: p.userId,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      // GameRecord doesn't persist the second commander, so a rematch from
      // history starts partner-less; picking the deck again restores it.
      partner: null,
      colorIdentity: [],
    })),
  };
}

/** One line of the play-ticker feed (see `PlayState.onlineTicker`). `id` is
 *  feed-unique (a per-adoption counter, never reused even across a seat's
 *  log restarting), so it's safe as a render key and as an edge-trigger for
 *  "a new line arrived".
 *
 *  Two kinds share the one feed on purpose. A `'play'` line is projected
 *  from a seat's game log (`toPublicTicker`) and narrates what the table
 *  did; a `'chat'` line is what a player typed. Interleaving them in arrival
 *  order is the whole value — "Maya played Sol Ring" / "Maya: hold, I
 *  respond" reads as one conversation, and splitting them into two feeds
 *  would force a player to reconstruct that ordering by eye. They stay
 *  DISTINGUISHABLE rather than merged into one text field because they carry
 *  different trust: a play line is machine-generated from state under the
 *  projection.ts visibility contract, a chat line is free text another
 *  player wrote. Renderers must not present the second as the first. */
/** One arrow on the table. `id` is the signal identity, unique per table. */
export interface TableArrow {
  id: string;
  /** The seat that drew it. */
  seat: number;
  fromSeat: number;
  fromCardId?: string;
  toSeat: number;
  toCardId?: string;
}

export type TickerItem =
  | { id: number; seat: number; kind: 'play'; entry: TickerEntry }
  | { id: number; seat: number; kind: 'chat'; text: string };

interface PlayState {
  /** Active local (shared-device) game, if any. */
  local: GameState | null;
  /** Active online game subscription (host or joined), if any. */
  online: GameState | null;
  /**
   * Latest published `PublicBoard` per opponent seat for the active online
   * game, received over the real-time transport (SSE/long-poll) — see
   * `applyServerBoard`. Ephemeral: never persisted, reset whenever the
   * online game session starts or ends. Nothing renders this yet (the
   * opponent rail UI is a separate, in-flight change); this only wires the
   * receiving half so that UI has data to read once it lands.
   */
  onlineBoards: Record<number, PublicBoard>;
  /**
   * Cross-seat requests for the active online game, keyed by requester seat
   * — mirrors `onlineBoards`. Fed by the same real-time transport (SSE/
   * long-poll onRequest — see `applyServerRequest`). A resolved request
   * stays here (server sends its final state; nothing overwrites it) until
   * the requester's seat raises another one, so a consumer can show its
   * terminal status rather than have it vanish. Ephemeral, reset whenever
   * the online session starts or ends — same lifecycle as `onlineBoards`.
   * Nothing renders this yet; rewind consent (a separate, in-flight change)
   * is the first consumer.
   */
  onlineRequests: Record<number, GameRequest>;
  /**
   * Most recent ephemeral table signal (reaction emote / dice roll) for the
   * active online game — see `applyServerSignal`. Unlike boards/requests
   * there is no per-seat history: signals are fire-and-forget moments, so
   * consumers key off `seq` (monotonic, so an identical signal re-fires —
   * same pattern as `lastResistanceEvent` in the playtest store) and render
   * transiently. Reset whenever the online session starts or ends.
   */
  onlineSignal: { seq: number; signal: GameSignal } | null;
  /**
   * Arrows drawn on the table — a point that stays. Every seat sees the same
   * list: `add` appends, `clear` drops every arrow its author drew. Ephemeral
   * like the other signals (no catch-up on reconnect), reset with the session.
   */
  onlineArrows: TableArrow[];
  /**
   * The play ticker: a merged, arrival-ordered feed of every seat's public
   * log lines for the active online game — "Maya played Sol Ring" narrative
   * instead of board-diffing. Fed by `ingestTicker` from two symmetric
   * sources: opponents' lines via `applyServerBoard` (each `PublicBoard`
   * carries its seat's trailing lines — see `toPublicTicker`), and this
   * device's own lines from the publish path (use-online-table.ts), so the
   * feed shows exactly what each seat's opponents can see, own seat
   * included. Ephemeral, reset with the session — same lifecycle as
   * `onlineBoards`.
   */
  onlineTicker: TickerItem[];
  /**
   * The user's game history, both modes in one list. Signed in, this is a
   * read of the server's canonical `game_results` table (`loadHistory`),
   * with any local game still waiting to post layered on top; a guest's is
   * device-only. Persisted so the tab opens on the last known list offline.
   */
  history: GameRecord[];
  /**
   * Finished local games that haven't reached the server yet — recorded
   * offline, or the post failed. Flushed in order on boot, on Play mount and
   * right after a game ends; a permanent rejection (4xx) drops the entry so
   * a bad game can't jam the queue. Persisted. Empty for guests.
   */
  pendingResults: GameState[];
  hydrated: boolean;
  /** Last error from an online action; surfaced in the UI. */
  onlineError: string | null;
  /** Whether the online poll loop is running. */
  onlinePolling: boolean;
  /**
   * When false the active game (local OR online) is minimized — the
   * fullscreen board is hidden so the user can navigate the rest of the
   * app, but the underlying game state is kept intact and is resumable.
   */
  boardVisible: boolean;
  /** Vibration feedback on taps / lethal hits. Persisted; default on. */
  hapticsEnabled: boolean;
  /**
   * Show the total game time on the board, and let it be paused/resumed.
   * Persisted; default on (see the store's `migrate` — this and
   * `turnTrackerEnabled` replace the single `showClock` flag as of version 2,
   * split like Lotus's own "Enable game timer" / "Enable turn tracker").
   */
  gameTimerEnabled: boolean;
  /** Show the active seat's turn time and let the clock pass the turn.
   *  Persisted; default on, same split as `gameTimerEnabled`. */
  turnTrackerEnabled: boolean;
  /** Blink a red ring on a seat below 10 life (Lotus's "Low health warning").
   *  Persisted; default on. `prefers-reduced-motion` swaps the blink for a
   *  steady ring (see `play-enhancements.css`). */
  lowLifeWarningEnabled: boolean;
  /** Underline the digits 6 and 9 in every board numeral (life, commander
   *  damage, high roll) so they can't be misread upside down. Persisted;
   *  default off (Lotus's "Underlined 6 and 9" is opt-in too). */
  underlineSixNine: boolean;
  /** Hide the visible ± glyphs beside the life numeral (Lotus's "Minimalist
   *  mode"). The tap zones and the step buttons themselves keep working —
   *  only the glyphs (and their burst-count badge) are visually hidden, kept
   *  in the DOM for screen reader / keyboard access. Persisted; default off. */
  minimalistMode: boolean;
  /**
   * The starting life last chosen for a 2-player table, remembered
   * separately from `startingLifeMultiplayer` (Lotus splits these the same
   * way). `null` means no override yet — the setup form falls back to the
   * picked format's own default. Persisted, device-local (a property of how
   * this device's setup form defaults, not of any one game).
   */
  startingLifeTwoPlayer: number | null;
  /** The starting life last chosen for a 3+ player table. See
   *  `startingLifeTwoPlayer` — same rules, the other bracket. */
  startingLifeMultiplayer: number | null;
  /**
   * Saved table setups — a pod that plays the same four people every week
   * shouldn't retype the roster each session. Persisted locally only: this is
   * a property of one device's regular table, not of the account, and it is
   * deliberately not part of the per-row user-data sync.
   */
  tableProfiles: TableProfile[];
  /**
   * Remembered board layout per player count (keyed by count). New local
   * games of that size start in this arrangement instead of the built-in
   * default. Persisted. Holds preset ids or serialized custom layouts.
   */
  preferredLayouts: Record<number, string>;
  /**
   * Set by a game night's "Start game" (host, non-cancelled, non-polling
   * night): the local setup form reads this once on mount to pre-fill player
   * names + format, then clears it. Not persisted — it's a one-shot handoff
   * to the next Play tab render, same tab in the same session.
   */
  gameNightSeed: { players: SeatSeed[]; format: GameFormat | null } | null;

  // ── Board visibility ────────────────────────────────────────────────────
  hideBoard(): void;
  showBoard(): void;
  setHaptics(enabled: boolean): void;
  setGameTimerEnabled(enabled: boolean): void;
  setTurnTrackerEnabled(enabled: boolean): void;
  setLowLifeWarningEnabled(enabled: boolean): void;
  setUnderlineSixNine(enabled: boolean): void;
  setMinimalistMode(enabled: boolean): void;
  /** Remember the starting life last chosen for the given player-count
   *  bracket ('two' = exactly 2, 'multi' = 3+). */
  setStartingLifeForBracket(bracket: 'two' | 'multi', life: number): void;
  /** Save (or overwrite, by name) a setup as a reusable table profile. */
  saveTableProfile(name: string, setup: LocalGameSetup): void;
  deleteTableProfile(id: string): void;
  /** Remember (or clear, with null) the default layout for `count` seats. */
  setPreferredLayout(count: number, layout: string | null): void;

  // ── Game night hand-off ─────────────────────────────────────────────────
  /** Seed the local setup form with attendee names + an optional format id. */
  seedGameSetup(players: SeatSeed[], format?: string | null): void;
  clearGameSeed(): void;

  // ── Local game ──────────────────────────────────────────────────────────
  startLocal(setup: LocalGameSetup): void;
  /** Start a fresh local game reusing a finished game's roster + settings. */
  rematchLocal(record: RematchTemplate): void;
  dispatchLocal(action: GameAction): void;
  endLocal(winnerSeat: number | null): void;
  discardLocal(): void;

  // ── Online game ─────────────────────────────────────────────────────────
  hostOnline(input: CreateGameInput): Promise<GameState>;
  joinOnline(code: string, input: JoinGameInput): Promise<GameState>;
  /** Watch a table without taking a seat. Only possible while its host has
   *  spectators switched on; otherwise the read 404s like any unknown code. */
  watchOnline(code: string): Promise<GameState>;
  refreshOnline(): Promise<void>;
  dispatchOnline(actions: GameAction | GameAction[]): Promise<void>;
  leaveOnline(): Promise<void>;
  clearOnline(): void;
  startPolling(): void;
  stopPolling(): void;
  /** Raise a cross-seat request (today: rewind consent). Throws on failure — see `raiseGameRequest`'s doc comment for the 409 (already-pending) case. */
  raiseGameRequest(
    kind: GameRequest['kind'],
    payload: GameRequest['payload']
  ): Promise<GameRequest>;
  /** Approve/decline a pending request raised by another seat. */
  respondGameRequest(id: string, approve: boolean): Promise<GameRequest>;
  /** Withdraw a still-pending request this seat raised. */
  cancelGameRequest(id: string): Promise<GameRequest>;
  /** Send an ephemeral table signal (reaction emote / dice roll). Best-effort
   *  — failures are swallowed; the sender's own copy is echoed locally from
   *  the POST response (the transport re-delivery is deduped by seat+ts). */
  sendSignal(input: GameSignalInput): Promise<void>;
  /** Merge one seat's published ticker window into `onlineTicker` — new
   *  lines only (per-seat `seq` diffing, so the constant re-delivery of
   *  whole windows is idempotent). The publish path calls this for the own
   *  seat; `applyServerBoard` calls the same logic for peers. */
  ingestTicker(seat: number, ticker: TickerEntry[] | undefined): void;

  // ── History ─────────────────────────────────────────────────────────────
  /** Replace history (used by sync hydration). */
  setHistory(records: GameRecord[]): void;
  /**
   * Drop a game from the list, and from the server when the caller recorded
   * it there (a local game they posted). An online row is the table's shared
   * record and is never deleted — callers hide the control for those.
   */
  removeHistory(id: string): void;
  /**
   * Correct the attribution on a game this account recorded: who won, and
   * which deck sat where. Shown at once, then written — a game still queued
   * for upload is corrected in the queue instead, so the upload carries the
   * fix rather than the mistake.
   */
  editHistory(id: string, edit: GameResultEdit): Promise<void>;
  /**
   * Drop an online game out of this account's list, or put it back. An online
   * row is the table's shared record, so this hides it and never retracts it;
   * every stats read still counts the game. Guests have no server list, so it
   * just leaves the device's own list.
   */
  setHistoryHidden(id: string, hidden: boolean): Promise<void>;
  /** The rows this account has hidden, fetched on demand so they can be
   *  offered back. Empty until `loadHiddenHistory` runs. */
  hiddenHistory: GameRecord[];
  /** How many rows this account has hidden, known from any history read —
   *  so the History tab can offer them without a speculative request. */
  hiddenCount: number;
  loadHiddenHistory(): Promise<void>;
  /** Signed in: replace `history` with the server's list. Guests: no-op. */
  loadHistory(): Promise<void>;
  /** Post every queued local result, oldest first. No-op for guests. */
  flushPendingResults(): Promise<void>;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Installed by startPolling, removed by stopPolling. Pauses the poll interval
 * while the tab/app is backgrounded — a hidden game board has no reason to keep
 * fetching state every 2.5s, and an abandoned-but-open tab would otherwise poll
 * indefinitely. Re-shows trigger an immediate catch-up poll.
 */
let pollVisibilityHandler: (() => void) | null = null;
/**
 * Online dispatch model: every dispatchOnline call applies optimistically to
 * the UI immediately, then appends to a pending queue. A single-flight
 * flusher drains the queue, sending each batch with the *server-confirmed*
 * version (tracked separately from the optimistic display version). On
 * success the server's state becomes the new base; any still-pending actions
 * are re-applied on top of it for continued optimistic display.
 */
let pendingActions: GameAction[] = [];
let flushPromise: Promise<void> | null = null;
let serverVersion = 0;
let serverCode: string | null = null;

/**
 * The push transport (SSE on web, long-poll on native — see
 * `usesLongPoll`) is primary once connected; the 2.5s poll (below) stays
 * wired as the fallback and is what actually detects "game is gone" (404) —
 * see `tick` and `applyServerGameState`. `sse` / `longPoll` are the
 * teardown fns from `subscribeGameEvents` / `subscribeGameLongPoll`,
 * doubling as "already subscribed" markers. Exactly one of the two is ever
 * active; both feed the same `realtimeHealthy` flag `tick` gates on.
 */
let sse: (() => void) | null = null;
let longPoll: (() => void) | null = null;
let longPollRetryTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeHealthy = false;
/** Backoff before retrying a failed long-poll — avoids hot-looping a flaky connection. */
const LONGPOLL_RETRY_MS = 5000;

/**
 * When `tick` last actually re-checked the server, real or transport-skipped.
 * Read by `tick`'s occasional liveness check (see `startPolling`) — see the
 * doc comment there for why a "the transport reports healthy" flag alone
 * can't be trusted to mean "the session still exists."
 */
let lastLivenessCheckAt = 0;
/**
 * How long a transport can report "healthy" before the interval poll
 * force-rechecks anyway. See `startPolling`'s `tick`.
 */
const LIVENESS_CHECK_INTERVAL_MS = 30_000;

/** Setter shape covering both call forms used below — `recordIfFinished` needs the updater-fn overload. */
type PlaySet = (partial: Partial<PlayState> | ((s: PlayState) => Partial<PlayState>)) => void;

/**
 * Adopt a server-pushed (or freshly-fetched) GameState, shared by the poll
 * path and the SSE path so both go through the same optimistic-dispatch
 * guard: skip while a patch is in flight (the flusher will adopt the
 * server's reply itself) and ignore anything not newer than what we have —
 * a push racing an older poll response, or arriving out of order, must not
 * roll the board backward.
 */
function applyServerGameState(fresh: GameState, set: PlaySet): void {
  if (flushPromise) return;
  if (pendingActions.length === 0 && fresh.version > serverVersion) {
    serverVersion = fresh.version;
    set({ online: fresh, onlineError: null });
    recordIfFinished(fresh, set);
  }
}

/**
 * Adopt a peer's published board — a catch-up frame or a live push, from
 * either transport. Unlike game state there's no version to reconcile
 * against: boards aren't ordered relative to each other, so the latest
 * received for a seat always wins.
 */
function applyServerBoard(seat: number, board: PublicBoard, set: PlaySet): void {
  set((s) => ({ onlineBoards: { ...s.onlineBoards, [seat]: board } }));
  ingestTickerLines(seat, board.ticker, set);
}

/** Feed cap — old lines fall off; the point is recent narrative, not a
 *  replayable history (each seat's own full log is its own device's). */
const TICKER_FEED_LIMIT = 60;
/** Highest ticker `seq` adopted per seat — the diff cursor that makes
 *  re-delivered windows (boards arrive constantly: publishes, poll
 *  snapshots, reconnect catch-ups) idempotent. Module-level like
 *  `serverVersion`; cleared wherever the online slice resets. */
const tickerSeen = new Map<number, number>();
let nextTickerItemId = 1;

function ingestTickerLines(seat: number, ticker: TickerEntry[] | undefined, set: PlaySet): void {
  if (!ticker || ticker.length === 0) return;
  const seen = tickerSeen.get(seat) ?? 0;
  const maxSeq = ticker[ticker.length - 1].seq;
  // A seat's max seq moving BACKWARD means its log restarted (a fresh
  // playtest session reseeds `gameLog` at seq 1) — adopt the whole window
  // rather than filtering against a cursor from the previous game.
  const fresh = maxSeq < seen ? ticker : ticker.filter((e) => e.seq > seen);
  if (fresh.length === 0) return;
  tickerSeen.set(seat, maxSeq);
  const items = fresh.map(
    (entry): TickerItem => ({ id: nextTickerItemId++, seat, kind: 'play', entry })
  );
  set((s) => ({ onlineTicker: [...s.onlineTicker, ...items].slice(-TICKER_FEED_LIMIT) }));
}

/**
 * Adopt a cross-seat request's create/respond/resolve frame — a catch-up
 * entry on (re)connect, or a live push. Keyed by requester seat like
 * `applyServerBoard`; the server is the sole author of `status`/`approvals`,
 * so this always just overwrites with whatever it sent, no reconciliation.
 */
function applyServerRequest(request: GameRequest, set: PlaySet): void {
  set((s) => ({ onlineRequests: { ...s.onlineRequests, [request.requesterSeat]: request } }));
}

/**
 * Identities — `${seat}:${ts}` — of table signals already adopted, so a
 * signal delivered twice is adopted once.
 *
 * This replaces an older check that compared only against the immediately
 * previous signal. That was enough while a duplicate could only be the
 * sender's own POST-response echo racing its transport frame back-to-back,
 * and while the worst case was one emote animating twice. It is NOT enough
 * now: any signal from another seat landing between those two frames pushed
 * the original out of "previous" and let the echo through, and with chat on
 * this channel that means a message the sender typed once appearing in the
 * feed twice. The server guarantees the (seat, ts) pair is unique per signal
 * (see `nextSignalTs` in the route), so remembering the pair is exact.
 *
 * Bounded and FIFO-evicted: a `Set` iterates in insertion order, so dropping
 * `values().next()` drops the oldest. The cap is far above any plausible
 * in-flight window (duplicates arrive within a round-trip of each other),
 * so eviction only ever discards identities long past being re-deliverable.
 * Module-level and cleared wherever the online slice resets, exactly like
 * `tickerSeen`.
 */
const signalSeen = new Set<string>();
/** Most arrows the table keeps at once; the oldest fall off first. */
const ARROW_LIMIT = 24;
const SIGNAL_SEEN_LIMIT = 200;

/**
 * Adopt an ephemeral table signal from either delivery path — the sender's
 * own POST-response echo (see `sendSignal`) or the transport broadcast. The
 * same frame arrives on both for the sender, hence the (seat, ts) dedupe
 * above. `seq` increments per adopted signal so consumers re-fire on repeats
 * (two identical emotes in a row are two moments, not one).
 *
 * A `'chat'` signal is the one kind that ALSO lands somewhere durable-ish:
 * it appends to `onlineTicker`, so a message stays readable in the table
 * feed instead of flashing past like an emote. It still goes through
 * `onlineSignal` as well, so the transient layer can announce an incoming
 * message the same way it announces a roll.
 */
function applyServerSignal(signal: GameSignal, set: PlaySet): void {
  const identity = `${signal.seat}:${signal.ts}`;
  if (signalSeen.has(identity)) return;
  signalSeen.add(identity);
  if (signalSeen.size > SIGNAL_SEEN_LIMIT) {
    const oldest = signalSeen.values().next().value;
    if (oldest !== undefined) signalSeen.delete(oldest);
  }
  set((s) => {
    const next: Partial<PlayState> = {
      onlineSignal: { seq: (s.onlineSignal?.seq ?? 0) + 1, signal },
    };
    if (signal.kind === 'arrow') {
      if (signal.op === 'clear') {
        next.onlineArrows = s.onlineArrows.filter((a) => a.seat !== signal.seat);
      } else if (signal.op === 'add' && signal.fromSeat != null && signal.toSeat != null) {
        const arrow: TableArrow = {
          id: identity,
          seat: signal.seat,
          fromSeat: signal.fromSeat,
          toSeat: signal.toSeat,
          ...(signal.fromCardId !== undefined && { fromCardId: signal.fromCardId }),
          ...(signal.toCardId !== undefined && { toCardId: signal.toCardId }),
        };
        // Bounded: a table that never clears still can't grow this without end.
        next.onlineArrows = [...s.onlineArrows, arrow].slice(-ARROW_LIMIT);
      }
    }
    // `text` is non-empty by construction server-side; the guard is for a
    // frame from an older/other client that sent a chat kind without one.
    if (signal.kind === 'chat' && signal.text) {
      const line: TickerItem = {
        id: nextTickerItemId++,
        seat: signal.seat,
        kind: 'chat',
        text: signal.text,
      };
      next.onlineTicker = [...s.onlineTicker, line].slice(-TICKER_FEED_LIMIT);
    }
    return next;
  });
}

function startSSE(set: PlaySet): void {
  // `EventSource` doesn't exist in Node (SSR / the test environment) — guard
  // rather than crash; the poll loop (tick, gated on realtimeHealthy staying
  // false) carries the whole load exactly as it did before this feature.
  if (sse || !serverCode || typeof EventSource === 'undefined') return;
  sse = subscribeGameEvents(serverCode, {
    onState: (state) => applyServerGameState(state, set),
    onBoard: (seat, board) => applyServerBoard(seat, board, set),
    onRequest: (request) => applyServerRequest(request, set),
    onSignal: (signal) => applyServerSignal(signal, set),
    onOpen: () => {
      realtimeHealthy = true;
    },
    onError: () => {
      realtimeHealthy = false;
    },
  });
}

function stopSSE(): void {
  sse?.();
  sse = null;
}

/**
 * Long-poll transport for native (see `usesLongPoll`). Self-heals: a failed
 * round-trip stops the loop and marks unhealthy so `tick` picks the game up
 * on its next 2.5s beat, then this schedules exactly one retry after
 * `LONGPOLL_RETRY_MS` instead of hot-looping reconnects.
 */
function startLongPoll(set: PlaySet): void {
  if (longPoll || !serverCode) return;
  longPoll = subscribeGameLongPoll(serverCode, () => serverVersion, {
    onState: (state) => applyServerGameState(state, set),
    onBoard: (seat, board) => applyServerBoard(seat, board, set),
    onRequest: (request) => applyServerRequest(request, set),
    onSignal: (signal) => applyServerSignal(signal, set),
    onHealthy: () => {
      realtimeHealthy = true;
    },
    onError: () => {
      realtimeHealthy = false;
      longPoll = null;
      longPollRetryTimer = setTimeout(() => {
        longPollRetryTimer = null;
        startLongPoll(set);
      }, LONGPOLL_RETRY_MS);
    },
  });
}

function stopLongPoll(): void {
  longPoll?.();
  longPoll = null;
  if (longPollRetryTimer) {
    clearTimeout(longPollRetryTimer);
    longPollRetryTimer = null;
  }
}

function startRealtime(set: PlaySet): void {
  if (usesLongPoll()) startLongPoll(set);
  else startSSE(set);
}

function stopRealtime(): void {
  stopSSE();
  stopLongPoll();
  realtimeHealthy = false;
}

/** Tear down and reopen — used to recover a connection a backgrounded WebView dropped silently. */
function restartRealtime(set: PlaySet): void {
  stopRealtime();
  startRealtime(set);
}

/**
 * Refetch server state after a patch conflict. Drains the pending queue,
 * re-fetches the authoritative game, and updates the online slice with
 * the supplied `onlineError` message. `fallbackError` is set when the
 * refetch itself fails (or returns null) — pass null to silently swallow
 * those cases (409 pattern) or a string to surface them (403 pattern).
 */
async function recoverFromServerState(
  code: string,
  successError: string,
  fallbackError: string | null,
  set: (partial: Partial<PlayState>) => void
): Promise<void> {
  pendingActions = [];
  try {
    const fresh = await apiGetGame(code);
    if (fresh) {
      serverVersion = fresh.version;
      set({ online: fresh, onlineError: successError });
    } else if (fallbackError !== null) {
      set({ onlineError: fallbackError });
    }
  } catch {
    if (fallbackError !== null) {
      set({ onlineError: fallbackError });
    }
    /* else: surfaced via subsequent poll (409 pattern) */
  }
}

/**
 * Shared teardown for leaveOnline / clearOnline: stop polling, drain the
 * pending-action queue, reset module-level server identity, and clear the
 * online slice of store state. Does NOT call apiLeaveGame — that's the
 * caller's responsibility when the server needs to be notified.
 */
function resetOnlineState(
  game: GameState,
  set: (partial: Partial<PlayState>) => void,
  stopPollingFn: () => void
): void {
  clearUndo(game.id);
  stopPollingFn();
  cancelBoardPublish();
  pendingActions = [];
  serverCode = null;
  serverVersion = 0;
  tickerSeen.clear();
  signalSeen.clear();
  set({
    online: null,
    onlineError: null,
    boardVisible: true,
    onlineBoards: {},
    onlineRequests: {},
    onlineSignal: null,
    onlineArrows: [],
    onlineTicker: [],
  });
}

function recordIfFinished(
  state: GameState,
  set: (fn: (s: PlayState) => Partial<PlayState>) => void
) {
  if (state.status === 'finished' && state.endedAt) {
    let queued = false;
    set((s) => {
      if (s.history.some((r) => r.id === state.id)) return {};
      const next: Partial<PlayState> = {
        history: [gameToRecord(state, state.endedAt!), ...s.history].slice(0, 500),
      };
      // A finished ONLINE game already has its canonical row (the server
      // wrote it when the session flipped); a LOCAL one exists only on this
      // device until it's posted. Queue it here, flush below — once, outside
      // the setter, so a rehydrated queue and this one never double-post.
      if (state.mode === 'local' && !s.pendingResults.some((g) => g.id === state.id)) {
        next.pendingResults = [...s.pendingResults, state];
        queued = true;
      }
      return next;
    });
    if (queued) void usePlayStore.getState().flushPendingResults();
  }
}

/** True when a signed-in account can post to / read from the server record. */
function signedIn(): boolean {
  return useAuth.getState().status === 'authed';
}

/** A 4xx other than 429 is a verdict, not a hiccup — retrying can't change it. */
function isPermanentRejection(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

let flushInFlight: Promise<void> | null = null;

export const usePlayStore = create<PlayState>()(
  persist(
    (set, get) => ({
      local: null,
      online: null,
      onlineBoards: {},
      onlineRequests: {},
      onlineSignal: null,
      onlineArrows: [],
      onlineTicker: [],
      history: [],
      hiddenHistory: [],
      hiddenCount: 0,
      pendingResults: [],
      hydrated: false,
      onlineError: null,
      onlinePolling: false,
      boardVisible: true,
      hapticsEnabled: true,
      gameTimerEnabled: true,
      turnTrackerEnabled: true,
      lowLifeWarningEnabled: true,
      underlineSixNine: false,
      minimalistMode: false,
      startingLifeTwoPlayer: null,
      startingLifeMultiplayer: null,
      tableProfiles: [],
      preferredLayouts: {},
      gameNightSeed: null,

      hideBoard: () => set({ boardVisible: false }),
      showBoard: () => set({ boardVisible: true }),
      setHaptics: (enabled) => {
        setHapticsEnabled(enabled);
        set({ hapticsEnabled: enabled });
      },
      setGameTimerEnabled: (enabled) => set({ gameTimerEnabled: enabled }),
      setTurnTrackerEnabled: (enabled) => set({ turnTrackerEnabled: enabled }),
      setLowLifeWarningEnabled: (enabled) => set({ lowLifeWarningEnabled: enabled }),
      setUnderlineSixNine: (enabled) => set({ underlineSixNine: enabled }),
      setMinimalistMode: (enabled) => set({ minimalistMode: enabled }),
      setStartingLifeForBracket: (bracket, life) =>
        set(
          bracket === 'two' ? { startingLifeTwoPlayer: life } : { startingLifeMultiplayer: life }
        ),
      saveTableProfile: (name, setup) => {
        const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_NAME_LENGTH);
        if (!trimmed) return;
        set((s) => {
          // Same name = the same table, updated. Two rows reading "Thursday
          // pod" would be unusable, and re-saving a tweaked roster under its
          // existing name is the common case.
          const existing = s.tableProfiles.find(
            (p) => p.name.toLowerCase() === trimmed.toLowerCase()
          );
          const row: TableProfile = {
            id: existing?.id ?? genId('profile'),
            name: trimmed,
            savedAt: Date.now(),
            setup,
          };
          return {
            tableProfiles: existing
              ? s.tableProfiles.map((p) => (p.id === existing.id ? row : p))
              : [...s.tableProfiles, row],
          };
        });
      },
      deleteTableProfile: (id) =>
        set((s) => ({ tableProfiles: s.tableProfiles.filter((p) => p.id !== id) })),
      setPreferredLayout: (count, layout) => {
        set((s) => {
          const nextLayouts = { ...s.preferredLayouts };
          if (layout == null) delete nextLayouts[count];
          else nextLayouts[count] = layout;
          return { preferredLayouts: nextLayouts };
        });
      },

      seedGameSetup: (players, format) => {
        const gameFormat = FORMAT_OPTIONS.some((f) => f.value === format)
          ? (format as GameFormat)
          : null;
        set({ gameNightSeed: { players, format: gameFormat } });
      },
      clearGameSeed: () => set({ gameNightSeed: null }),

      // ── Local ─────────────────────────────────────────────────────────────
      startLocal: (setup) => {
        const players: GamePlayer[] = setup.players.map((p, i) =>
          makePlayer({
            id: `local_${i}`,
            userId: p.userId ?? null,
            seat: i,
            name: p.name,
            deckId: p.deckId,
            deckName: p.deckName,
            commander: p.commander,
            partner: p.partner,
            colorIdentity: p.colorIdentity,
            startingLife: setup.startingLife,
            isHost: i === 0,
          })
        );
        // Pre-seed the table's regular counters at zero on every seat. Names
        // go through the reducer's normalizer so a profile saved with sloppy
        // whitespace can't create two counters that render identically, and a
        // bad name is dropped rather than failing the whole game start.
        const counterNames = (setup.counters ?? []).reduce<string[]>((acc, raw) => {
          try {
            const name = normalizeCounterName(raw);
            if (!acc.includes(name)) acc.push(name);
          } catch {
            /* unnamed counter in a stored profile — skip it, don't block play */
          }
          return acc;
        }, []);
        for (const p of players) {
          p.counters = Object.fromEntries(counterNames.map((n) => [n, 0]));
        }
        const game = createGameState({
          id: genId('game'),
          code: '',
          mode: 'local',
          hostUserId: null,
          format: setup.format,
          startingLife: setup.startingLife,
          commanderDamageEnabled: setup.commanderDamageEnabled,
          poisonEnabled: setup.poisonEnabled,
          // Honor a remembered arrangement for this table size, if any.
          layout: get().preferredLayouts[players.length],
          turnOrder: setup.turnOrder,
          players,
        });
        const started = applyAction(game, { type: 'start' });
        set({ local: started, boardVisible: true });
        // A local game is fully anonymous and syncs nothing, so this beacon is
        // the only evidence it ever happened. rematchLocal routes through here.
        track('play_started');
      },

      rematchLocal: (template) => {
        const prev = get().local;
        if (prev) clearUndo(prev.id);
        get().startLocal({
          format: template.format,
          startingLife: template.startingLife,
          commanderDamageEnabled: template.commanderDamageEnabled,
          poisonEnabled: template.poisonEnabled,
          turnOrder: template.turnOrder,
          players: template.players,
        });
      },

      dispatchLocal: (action) => {
        const cur = get().local;
        if (!cur) return;
        let next = applyAction(cur, action);
        // A reset drops the game back to `lobby`. That is right for an online
        // table — the host re-starts it from a real lobby screen — but the
        // local board has no lobby, so a reset used to strand the table there
        // for good: the clock vanished (no `startedAt` to derive from) and,
        // worse, loss conditions stopped firing, because the reducer only
        // evaluates auto-elimination and auto-win while a game is `active`.
        // Start the fresh game in the same breath, which is what "reset" means
        // at a physical table anyway.
        if (action.type === 'reset') next = applyAction(next, { type: 'start' });
        set({ local: next });
        recordIfFinished(next, set);
      },

      endLocal: (winnerSeat) => {
        const cur = get().local;
        if (!cur) return;
        const next = applyAction(cur, { type: 'end', winnerSeat });
        set({ local: next });
        recordIfFinished(next, set);
      },

      discardLocal: () => {
        const cur = get().local;
        if (cur) clearUndo(cur.id);
        set({ local: null, boardVisible: true });
      },

      // ── Online ────────────────────────────────────────────────────────────
      hostOnline: async (input) => {
        const game = await apiCreateGame(input);
        serverVersion = game.version;
        serverCode = game.code;
        tickerSeen.clear();
        signalSeen.clear();
        set({
          online: game,
          onlineError: null,
          boardVisible: true,
          onlineBoards: {},
          onlineRequests: {},
          onlineSignal: null,
          onlineArrows: [],
          onlineTicker: [],
        });
        get().startPolling();
        return game;
      },

      joinOnline: async (code, input) => {
        const game = await apiJoinGame(code.toUpperCase(), input);
        serverVersion = game.version;
        serverCode = game.code;
        tickerSeen.clear();
        signalSeen.clear();
        set({
          online: game,
          onlineError: null,
          boardVisible: true,
          onlineBoards: {},
          onlineRequests: {},
          onlineSignal: null,
          onlineArrows: [],
          onlineTicker: [],
        });
        get().startPolling();
        return game;
      },

      watchOnline: async (code) => {
        // No join, so no seat: the same fetch the poll loop already uses, then
        // the same local reset joinOnline does. The board renders a seatless
        // viewer already (OnlineGameView's "viewing this game without a
        // seat"), and every mutation stays server-side participant-only, so
        // there is nothing here to make read-only by hand.
        const game = await apiGetGame(code.toUpperCase());
        if (!game) throw new Error('Game not found.');
        serverVersion = game.version;
        serverCode = game.code;
        tickerSeen.clear();
        signalSeen.clear();
        set({
          online: game,
          onlineError: null,
          boardVisible: true,
          onlineBoards: {},
          onlineRequests: {},
          onlineSignal: null,
          onlineArrows: [],
          onlineTicker: [],
        });
        get().startPolling();
        return game;
      },

      refreshOnline: async () => {
        const code = serverCode;
        if (!code) return;
        try {
          // Pass our known version so an unchanged game short-circuits to a
          // tiny `{ unchanged: true }` reply (resolves to null) instead of
          // re-shipping the whole GameState on every 2.5s poll.
          const fresh = await apiGetGame(code, serverVersion);
          // A null reply means the version matched — nothing to do. Otherwise
          // route through the same guard/adoption logic the SSE push uses.
          if (fresh) applyServerGameState(fresh, set);
        } catch (err) {
          const e = err as Error & { status?: number };
          if (e.status === 404) {
            const cur = get().online;
            if (cur) resetOnlineState(cur, set, () => get().stopPolling());
            set({ onlineError: 'Game ended.' });
          }
        }
      },

      dispatchOnline: async (actions) => {
        const cur = get().online;
        if (!cur || !serverCode) return;
        const list = Array.isArray(actions) ? actions : [actions];

        // Apply optimistically for instant UI.
        let optimistic = cur;
        try {
          for (const a of list) optimistic = applyAction(optimistic, a);
        } catch (err) {
          set({ onlineError: userMessage(err, "That move isn't allowed right now.") });
          return;
        }
        set({ online: optimistic });
        pendingActions.push(...list);

        if (flushPromise) return flushPromise;
        flushPromise = (async () => {
          try {
            while (pendingActions.length > 0) {
              const batch = pendingActions.splice(0, pendingActions.length);
              const code = serverCode!;
              try {
                const result = await apiPatchGame(code, serverVersion, batch);
                serverVersion = result.game.version;
                // Re-apply any actions queued while this request was in flight
                // on top of the server's authoritative state.
                let next = result.game;
                for (const a of pendingActions) next = applyAction(next, a);
                set({ online: next, onlineError: null });
                recordIfFinished(result.game, set);
              } catch (err) {
                const e = err as Error & { status?: number };
                if (e.status === 409) {
                  // Server is ahead — drop the optimistic stack and refetch.
                  // No knownVersion here, so apiGetGame always returns the full
                  // state (never the null short-circuit).
                  await recoverFromServerState(
                    code,
                    'Someone else moved first. Refreshed.',
                    null, // 409: silently ignore !fresh / fetch errors (poll will catch up)
                    set
                  );
                } else if (e.status === 403) {
                  await recoverFromServerState(
                    code,
                    userMessage(e, "That move isn't allowed right now."),
                    userMessage(e, "That move isn't allowed right now."),
                    set
                  );
                } else {
                  // Anything else (500, network, a rejected action) used to
                  // only set an error string, which left the optimistic state
                  // permanently ahead of the server: the batch is spliced out
                  // of `pendingActions` before the request so nothing retries
                  // it, and the poller only adopts server state when
                  // `fresh.version > serverVersion` — which a *failed* patch
                  // never advances. The board kept showing an action the
                  // server never accepted until some other player happened to
                  // move. Reconcile like the 403 path, surfacing the failure
                  // whether or not the refetch succeeds.
                  await recoverFromServerState(
                    code,
                    userMessage(e, "That didn't go through. Try again."),
                    userMessage(e, "That didn't go through. Try again."),
                    set
                  );
                }
              }
            }
          } finally {
            flushPromise = null;
          }
        })();
        return flushPromise;
      },

      leaveOnline: async () => {
        const cur = get().online;
        if (!cur) return;
        try {
          await apiLeaveGame(cur.code);
        } catch {
          /* best effort */
        }
        resetOnlineState(cur, set, () => get().stopPolling());
      },

      raiseGameRequest: async (kind, payload) => {
        const code = serverCode;
        if (!code) throw new Error('Not in an online game.');
        const request = await apiRaiseGameRequest(code, kind, payload);
        applyServerRequest(request, set);
        return request;
      },

      respondGameRequest: async (id, approve) => {
        const code = serverCode;
        if (!code) throw new Error('Not in an online game.');
        const request = await apiRespondGameRequest(code, id, approve);
        applyServerRequest(request, set);
        return request;
      },

      cancelGameRequest: async (id) => {
        const code = serverCode;
        if (!code) throw new Error('Not in an online game.');
        const request = await apiCancelGameRequest(code, id);
        applyServerRequest(request, set);
        return request;
      },

      sendSignal: async (input) => {
        const code = serverCode;
        if (!code) return;
        try {
          const signal = await apiSendGameSignal(code, input);
          // Instant local echo — the transport's re-delivery of this same
          // frame is deduped by (seat, ts) in applyServerSignal.
          applyServerSignal(signal, set);
        } catch {
          /* ephemeral, best-effort — nothing to surface or retry */
        }
      },

      ingestTicker: (seat, ticker) => ingestTickerLines(seat, ticker, set),

      clearOnline: () => {
        const cur = get().online;
        if (cur) {
          resetOnlineState(cur, set, () => get().stopPolling());
        } else {
          // No active game but still clean up polling/queue in case they drifted.
          get().stopPolling();
          cancelBoardPublish();
          pendingActions = [];
          serverCode = null;
          serverVersion = 0;
          tickerSeen.clear();
          signalSeen.clear();
          set({
            online: null,
            onlineError: null,
            boardVisible: true,
            onlineBoards: {},
            onlineRequests: {},
            onlineSignal: null,
            onlineArrows: [],
            onlineTicker: [],
          });
        }
      },

      startPolling: () => {
        // `pollVisibilityHandler` (not `pollTimer`) is the "already polling"
        // marker: while the tab is hidden the interval is torn down but the
        // subscription is still logically active.
        if (pollVisibilityHandler) return;
        set({ onlinePolling: true });
        startRealtime(set);
        // Defer the first occasional liveness recheck a full interval out —
        // the caller (hostOnline/joinOnline, or a catch-up refresh) already
        // holds state as fresh as this instant.
        lastLivenessCheckAt = Date.now();

        // The push transport is primary once connected: skip the redundant
        // fetch on a tick that lands while it's healthy — EXCEPT
        // occasionally. `realtimeHealthy` only reflects the transport's OWN
        // error event, which a genuinely swept/deleted session may never
        // fire: an SSE stream's 25s heartbeat keeps writing to a socket that
        // is still open even though nobody will ever push to it again
        // (server-side normally closes it via broadcastGameDeleted, but that
        // relies on this client's subscriber having actually received the
        // broadcast — cross-machine delivery isn't guaranteed, see the
        // `subscribers` map's own ponytail comment in routes/games.ts). Left
        // unchecked, `tick` would then skip forever and the board would sit
        // on screen looking live. So: every tick still runs while unhealthy
        // (as before), and even while healthy, force a real refreshOnline at
        // least once per `LIVENESS_CHECK_INTERVAL_MS` — cheap, since a
        // genuinely-alive game just answers the `knownVersion` fast path
        // with `{ unchanged: true }`, and it's what actually detects "gone"
        // (a 404 clears the game — see refreshOnline).
        const tick = () => {
          const now = Date.now();
          const overdue = now - lastLivenessCheckAt >= LIVENESS_CHECK_INTERVAL_MS;
          if (realtimeHealthy && !overdue) return;
          lastLivenessCheckAt = now;
          void get().refreshOnline();
        };
        // Reconcile the interval with the current visibility state: run it
        // while visible, tear it down (and do nothing) while hidden. `catchUp`
        // fires one immediate REAL refresh (bypassing the realtimeHealthy gate) when
        // an interval is (re)created — used on a hidden→visible transition so
        // a returning tab doesn't wait a full interval, but skipped on the
        // initial start (callers already hold fresh state, or do their own
        // first refresh).
        const ensureInterval = (catchUp: boolean) => {
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          if (hidden) {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          } else if (!pollTimer) {
            pollTimer = setInterval(tick, POLL_INTERVAL_MS);
            if (catchUp) void get().refreshOnline();
          }
        };

        // A backgrounded Android WebView can drop the connection without
        // ever firing its error event, so a plain visibility flip can't rely
        // on `realtimeHealthy` alone — force-reconnect on every return to
        // visible. `restartRealtime` flips `realtimeHealthy` to false
        // synchronously (before the new connection opens), so the
        // `ensureInterval(true)` catch-up fetch below always runs for real too.
        const sync = () => {
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          if (!hidden) restartRealtime(set);
          ensureInterval(true);
        };
        pollVisibilityHandler = sync;
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', sync);
        }
        ensureInterval(false);
      },

      stopPolling: () => {
        stopRealtime();
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (pollVisibilityHandler && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', pollVisibilityHandler);
        }
        pollVisibilityHandler = null;
        lastLivenessCheckAt = 0;
        set({ onlinePolling: false });
      },

      // ── History ───────────────────────────────────────────────────────────
      setHistory: (records) => set({ history: records }),
      removeHistory: (id) => {
        const rec = get().history.find((r) => r.id === id);
        const wasPending = get().pendingResults.some((g) => g.id === id);
        set((s) => ({
          history: s.history.filter((r) => r.id !== id),
          pendingResults: s.pendingResults.filter((g) => g.id !== id),
        }));
        // Two kinds have a server row this account may remove: a local game it
        // posted, and an online game it hosted. Everything else is either
        // someone else's to delete (the server refuses it anyway) or still
        // queued, in which case dropping it from the queue IS the whole
        // delete — it never reached the server.
        const me = useAuth.getState().user?.id ?? null;
        const ownsLocal = rec?.mode === 'local' && !!me && rec.recordedByUserId === me;
        const hostsOnline = rec?.mode === 'online' && !!me && rec.hostUserId === me;
        if (!wasPending && (ownsLocal || hostsOnline)) {
          deleteGameResult(id).catch((err) =>
            logger.warn('[store] Failed to remove game from the server record:', err)
          );
        }
      },

      editHistory: async (id, edit) => {
        const before = get().history.find((r) => r.id === id);
        if (!before) return;
        const queued = get().pendingResults.find((g) => g.id === id);
        set((s) => ({
          history: s.history.map((r) => (r.id === id ? applyEditToRecord(r, edit) : r)),
          pendingResults: s.pendingResults.map((g) =>
            g.id === id ? applyEditToState(g, edit) : g
          ),
        }));
        // A game still in the queue has no server row yet — the corrected
        // state above IS the write. Same for a guest, and for a row this
        // account did not record (the server would refuse it anyway).
        const me = useAuth.getState().user?.id ?? null;
        if (queued || before.mode !== 'local' || !me || before.recordedByUserId !== me) return;
        try {
          const record = resultToRecord(await patchGameResult(id, edit));
          set((s) => ({ history: s.history.map((r) => (r.id === id ? record : r)) }));
        } catch (err) {
          // Put the row back as it was and say so. There is no outbox for
          // history, so a change that did not land must not sit there looking
          // saved.
          set((s) => ({ history: s.history.map((r) => (r.id === id ? before : r)) }));
          toast.show({
            message: userMessage(err, "Couldn't save that change."),
            tone: 'error',
          });
        }
      },

      setHistoryHidden: async (id, hidden) => {
        const rec = hidden
          ? get().history.find((r) => r.id === id)
          : get().hiddenHistory.find((r) => r.id === id);
        if (!rec) return;
        set((s) =>
          hidden
            ? {
                history: s.history.filter((r) => r.id !== id),
                hiddenHistory: [rec, ...s.hiddenHistory],
                hiddenCount: s.hiddenCount + 1,
              }
            : {
                history: [rec, ...s.history].sort((a, b) => b.endedAt - a.endedAt),
                hiddenHistory: s.hiddenHistory.filter((r) => r.id !== id),
                hiddenCount: Math.max(0, s.hiddenCount - 1),
              }
        );
        // A guest's list is this device's alone: there is nothing to tell the
        // server, and nothing that would come back on the next read.
        if (!signedIn()) return;
        try {
          await setGameResultHidden(id, hidden);
        } catch (err) {
          set((s) =>
            hidden
              ? {
                  history: [rec, ...s.history].sort((a, b) => b.endedAt - a.endedAt),
                  hiddenHistory: s.hiddenHistory.filter((r) => r.id !== id),
                  hiddenCount: Math.max(0, s.hiddenCount - 1),
                }
              : {
                  history: s.history.filter((r) => r.id !== id),
                  hiddenHistory: [rec, ...s.hiddenHistory],
                  hiddenCount: s.hiddenCount + 1,
                }
          );
          toast.show({
            message: userMessage(
              err,
              hidden ? "Couldn't hide that game." : "Couldn't bring that game back."
            ),
            tone: 'error',
          });
        }
      },

      loadHiddenHistory: async () => {
        if (!signedIn()) return;
        const { results } = await fetchMyResults({ limit: 200, hidden: true });
        set({ hiddenHistory: results.map(resultToRecord) });
      },

      loadHistory: async () => {
        if (!signedIn()) return;
        const { results, hiddenCount } = await fetchMyResults({ limit: 200 });
        const fromServer = results.map(resultToRecord);
        set({ hiddenCount });
        set((s) => {
          // A game still waiting to post is real history the server doesn't
          // know yet — keep its on-device record ahead of the server's list.
          const serverIds = new Set(fromServer.map((r) => r.id));
          const waiting = s.history.filter(
            (r) => !serverIds.has(r.id) && s.pendingResults.some((g) => g.id === r.id)
          );
          const merged = [...waiting, ...fromServer].sort((a, b) => b.endedAt - a.endedAt);
          return { history: merged.slice(0, 500), hydrated: true };
        });
      },

      flushPendingResults: () => {
        if (flushInFlight) return flushInFlight;
        if (!signedIn() || get().pendingResults.length === 0) return Promise.resolve();
        flushInFlight = (async () => {
          try {
            while (signedIn()) {
              const game = get().pendingResults[0];
              if (!game) break;
              try {
                const result = await postLocalResult(game);
                const record = resultToRecord(result);
                set((s) => ({
                  pendingResults: s.pendingResults.filter((g) => g.id !== game.id),
                  // Swap in the server's copy so the row now carries who
                  // recorded it (and the friends' usernames it resolved).
                  history: s.history.some((r) => r.id === record.id)
                    ? s.history.map((r) => (r.id === record.id ? record : r))
                    : [record, ...s.history].slice(0, 500),
                }));
              } catch (err) {
                if (isPermanentRejection(err)) {
                  // Say so once: the game stays on this device's list, but
                  // the server's next read won't carry it, and a silent drop
                  // would read as a game that never happened.
                  logger.warn(`[store] Server refused local game ${game.id}; dropping it:`, err);
                  toast.show({
                    message: userMessage(err, "Couldn't save a game to your record."),
                    tone: 'error',
                  });
                  set((s) => ({
                    pendingResults: s.pendingResults.filter((g) => g.id !== game.id),
                  }));
                  continue;
                }
                // Offline or a server hiccup: leave the queue for next time.
                logger.warn('[store] Could not post a local game yet; will retry:', err);
                break;
              }
            }
          } finally {
            flushInFlight = null;
          }
        })();
        return flushInFlight;
      },
    }),
    {
      name: 'mtg-play',
      version: 3,
      /**
       * v1 → v2: `showClock` gated the total game time and the turn segment
       * together; split into `gameTimerEnabled` + `turnTrackerEnabled` so
       * either can be turned off at setup on its own (Lotus's "Enable game
       * timer" / "Enable turn tracker"). A reader's existing choice carries
       * over unchanged to BOTH new flags — `showClock: true` (or absent, the
       * pre-preference default) already showed both readings, and `false`
       * hid both, so this is not a behavior change for anyone upgrading.
       *
       * v2 → v3: added the remaining Lotus board settings —
       * `lowLifeWarningEnabled` (default true, matches the always-on warning
       * every reader already saw before this was a preference),
       * `underlineSixNine` / `minimalistMode` (default off, both opt-in), and
       * the per-bracket `startingLifeTwoPlayer` / `startingLifeMultiplayer`
       * memory (default null — "no override yet", so the setup form keeps
       * falling back to the picked format's own default exactly as before).
       * None of these existed pre-v3, so there's nothing to read out of the
       * old state; the defaults below just need to be present.
       */
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Record<string, unknown> | undefined;
        if (!state) return state as never;
        if (fromVersion < 2) {
          const legacy = typeof state.showClock === 'boolean' ? state.showClock : true;
          state.gameTimerEnabled = legacy;
          state.turnTrackerEnabled = legacy;
          delete state.showClock;
        }
        if (fromVersion < 3) {
          if (typeof state.lowLifeWarningEnabled !== 'boolean') state.lowLifeWarningEnabled = true;
          if (typeof state.underlineSixNine !== 'boolean') state.underlineSixNine = false;
          if (typeof state.minimalistMode !== 'boolean') state.minimalistMode = false;
          if (typeof state.startingLifeTwoPlayer !== 'number') state.startingLifeTwoPlayer = null;
          if (typeof state.startingLifeMultiplayer !== 'number')
            state.startingLifeMultiplayer = null;
        }
        return state;
      },
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.hydrated = true;
        // Mirror the persisted haptics preference into the module flag.
        setHapticsEnabled(state.hapticsEnabled ?? true);
        // If we had an online game in flight (refresh, dropped wifi, accidental
        // tab close), seed the module-level polling identity from the persisted
        // snapshot. The PlayPage mount effect calls startPolling() + an
        // immediate refreshOnline(), which reconciles with the server — a 200
        // adopts the live state, a 404 clears it.
        if (state.online) {
          serverCode = state.online.code;
          // Leave serverVersion at 0 so the first refreshOnline after a reload
          // *always* adopts the server's authoritative state. The persisted
          // version may be optimistic (advanced locally for an action that
          // never reached the server before the refresh).
          serverVersion = 0;
        }
      },
      // Persist the active online game so a refresh or brief disconnect drops
      // the user back into their seat instead of the setup form. The server
      // is still the source of truth on next poll; persisted state is just a
      // hint that we *were* in a game.
      //
      // `history` is persisted here (not via the per-row user-data sync any
      // more): signed in, `loadHistory` replaces it from the canonical server
      // table on the next Play visit, so this copy is just what the tab shows
      // before that read lands, or offline; for a guest it is the whole
      // record. `pendingResults` must survive a reload or nothing recorded
      // offline would ever post.
      partialize: (s) => ({
        local: s.local,
        online: s.online,
        history: s.history,
        pendingResults: s.pendingResults,
        boardVisible: s.boardVisible,
        hapticsEnabled: s.hapticsEnabled,
        gameTimerEnabled: s.gameTimerEnabled,
        turnTrackerEnabled: s.turnTrackerEnabled,
        lowLifeWarningEnabled: s.lowLifeWarningEnabled,
        underlineSixNine: s.underlineSixNine,
        minimalistMode: s.minimalistMode,
        startingLifeTwoPlayer: s.startingLifeTwoPlayer,
        startingLifeMultiplayer: s.startingLifeMultiplayer,
        tableProfiles: s.tableProfiles,
        preferredLayouts: s.preferredLayouts,
      }),
    }
  )
);

// Play history is deliberately NOT part of the per-row user-data sync: a
// finished game is one shared, immutable record in `game_results` (server
// truth for both modes), not a per-user document to reconcile. `local` and
// `online` aren't synced either — a local game is a single-device session
// and an online game is owned by the game_sessions API.

/**
 * A result recorded while signed out (or before the account existed) posts
 * the moment the account is there: queue flush on every guest → authed
 * transition, plus a fresh read of the server's list.
 */
// Guarded like lib/use-ai-status.ts: component tests stand in a bare selector
// for `useAuth`, which has no `subscribe`.
if (typeof useAuth.subscribe === 'function') {
  useAuth.subscribe((state, prev) => {
    if (state.status !== 'authed' || prev.status === 'authed') return;
    const play = usePlayStore.getState();
    void play
      .flushPendingResults()
      .then(() => play.loadHistory())
      .catch(() => {});
  });
}

// ── Per-deck win/loss aggregation ───────────────────────────────────────────

export interface DeckRecordRow {
  deckId: string;
  deckName: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  lastPlayedAt: number;
}

/**
 * Compute W/L per deck for a given user. A "win" is when the user's seat is
 * the winnerSeat; a "loss" is any other finished game where the user
 * participated and the game had a winner. Draws (no winner) count as
 * played-but-neither.
 */
export function aggregateDeckRecords(
  history: GameRecord[],
  userId: string | null
): DeckRecordRow[] {
  const byDeck = new Map<string, DeckRecordRow>();
  for (const rec of history) {
    // Horde is co-op — there is no winning seat, and it belongs in its own
    // horde tally (aggregateHordeRecords), not a deck's PvP win rate.
    if (rec.format === 'horde') continue;
    for (const p of rec.players) {
      if (!p.deckId) continue;
      // For online games, attribute by userId; for local, attribute by deck
      // regardless (everyone shares the device).
      if (rec.mode === 'online' && p.userId !== userId) continue;
      const cur = byDeck.get(p.deckId) ?? {
        deckId: p.deckId,
        deckName: p.deckName ?? 'Untitled deck',
        played: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        lastPlayedAt: 0,
      };
      cur.played += 1;
      cur.lastPlayedAt = Math.max(cur.lastPlayedAt, rec.endedAt);
      if (rec.winnerSeat !== null) {
        if (rec.winnerSeat === p.seat) cur.wins += 1;
        else cur.losses += 1;
      }
      byDeck.set(p.deckId, cur);
    }
  }
  const rows = Array.from(byDeck.values());
  for (const r of rows) {
    const decided = r.wins + r.losses;
    r.winRate = decided > 0 ? r.wins / decided : 0;
  }
  rows.sort((a, b) => b.played - a.played || b.winRate - a.winRate);
  return rows;
}
