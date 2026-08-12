import { logger } from '@/lib/logger';
import { create } from 'zustand';
import { isApplyingServer } from '../lib/applying-server';
import { genId } from '../lib/id';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  applyAction,
  createGameState,
  gameToRecord,
  makePlayer,
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
  type CreateGameInput,
  type GameRequest,
  type JoinGameInput,
} from '../lib/games-api';
import { subscribeGameEvents } from '../lib/games-sse';
import { subscribeGameLongPoll, usesLongPoll } from '../lib/games-longpoll';
import { cancelBoardPublish } from '../lib/games-board';
import { setHapticsEnabled } from '../lib/haptics';
import { clearUndo } from '../lib/undo-stack';
import { FORMAT_OPTIONS } from '../lib/game-formats';
import type { PublicBoard } from '../lib/playtest/projection';

const POLL_INTERVAL_MS = 2500;

export interface LocalGameSetup {
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  players: Array<{
    name: string;
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
}

/** Minimal shape needed to re-seed a game from a finished one. */
export interface RematchTemplate {
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  players: LocalGameSetup['players'];
}

/** Derive a rematch template from a finished in-memory game. */
export function gameToRematch(game: GameState): RematchTemplate {
  return {
    format: game.format,
    startingLife: game.startingLife,
    commanderDamageEnabled: game.commanderDamageEnabled,
    poisonEnabled: game.poisonEnabled,
    players: game.players.map((p) => ({
      name: p.name,
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
    players: rec.players.map((p) => ({
      name: p.name,
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
  /** Per-user game history (synced via the user-data sync). */
  history: GameRecord[];
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
  gameNightSeed: { players: string[]; format: GameFormat | null } | null;

  // ── Board visibility ────────────────────────────────────────────────────
  hideBoard(): void;
  showBoard(): void;
  setHaptics(enabled: boolean): void;
  /** Remember (or clear, with null) the default layout for `count` seats. */
  setPreferredLayout(count: number, layout: string | null): void;

  // ── Game night hand-off ─────────────────────────────────────────────────
  /** Seed the local setup form with attendee names + an optional format id. */
  seedGameSetup(names: string[], format?: string | null): void;
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
  refreshOnline(): Promise<void>;
  dispatchOnline(actions: GameAction | GameAction[]): Promise<void>;
  leaveOnline(): Promise<void>;
  clearOnline(): void;
  startPolling(): void;
  stopPolling(): void;
  /** Raise a cross-seat request (today: rewind consent). Throws on failure — see `raiseGameRequest`'s doc comment for the 409 (already-pending) case. */
  raiseGameRequest(
    kind: 'rewind',
    payload: { steps: number; summary: string }
  ): Promise<GameRequest>;
  /** Approve/decline a pending request raised by another seat. */
  respondGameRequest(id: string, approve: boolean): Promise<GameRequest>;

  // ── History ─────────────────────────────────────────────────────────────
  /** Replace history (used by sync hydration). */
  setHistory(records: GameRecord[]): void;
  removeHistory(id: string): void;
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

function startSSE(set: PlaySet): void {
  // `EventSource` doesn't exist in Node (SSR / the test environment) — guard
  // rather than crash; the poll loop (tick, gated on realtimeHealthy staying
  // false) carries the whole load exactly as it did before this feature.
  if (sse || !serverCode || typeof EventSource === 'undefined') return;
  sse = subscribeGameEvents(serverCode, {
    onState: (state) => applyServerGameState(state, set),
    onBoard: (seat, board) => applyServerBoard(seat, board, set),
    onRequest: (request) => applyServerRequest(request, set),
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
  set({
    online: null,
    onlineError: null,
    boardVisible: true,
    onlineBoards: {},
    onlineRequests: {},
  });
}

function recordIfFinished(
  state: GameState,
  set: (fn: (s: PlayState) => Partial<PlayState>) => void
) {
  if (state.status === 'finished' && state.endedAt) {
    set((s) => {
      if (s.history.some((r) => r.id === state.id)) return {};
      return { history: [gameToRecord(state, state.endedAt!), ...s.history].slice(0, 500) };
    });
  }
}

export const usePlayStore = create<PlayState>()(
  persist(
    (set, get) => ({
      local: null,
      online: null,
      onlineBoards: {},
      onlineRequests: {},
      history: [],
      hydrated: false,
      onlineError: null,
      onlinePolling: false,
      boardVisible: true,
      hapticsEnabled: true,
      preferredLayouts: {},
      gameNightSeed: null,

      hideBoard: () => set({ boardVisible: false }),
      showBoard: () => set({ boardVisible: true }),
      setHaptics: (enabled) => {
        setHapticsEnabled(enabled);
        set({ hapticsEnabled: enabled });
      },
      setPreferredLayout: (count, layout) => {
        set((s) => {
          const nextLayouts = { ...s.preferredLayouts };
          if (layout == null) delete nextLayouts[count];
          else nextLayouts[count] = layout;
          return { preferredLayouts: nextLayouts };
        });
      },

      seedGameSetup: (names, format) => {
        const gameFormat = FORMAT_OPTIONS.some((f) => f.value === format)
          ? (format as GameFormat)
          : null;
        set({ gameNightSeed: { players: names, format: gameFormat } });
      },
      clearGameSeed: () => set({ gameNightSeed: null }),

      // ── Local ─────────────────────────────────────────────────────────────
      startLocal: (setup) => {
        const players: GamePlayer[] = setup.players.map((p, i) =>
          makePlayer({
            id: `local_${i}`,
            userId: null,
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
          players,
        });
        const started = applyAction(game, { type: 'start' });
        set({ local: started, boardVisible: true });
      },

      rematchLocal: (template) => {
        const prev = get().local;
        if (prev) clearUndo(prev.id);
        get().startLocal({
          format: template.format,
          startingLife: template.startingLife,
          commanderDamageEnabled: template.commanderDamageEnabled,
          poisonEnabled: template.poisonEnabled,
          players: template.players,
        });
      },

      dispatchLocal: (action) => {
        const cur = get().local;
        if (!cur) return;
        const next = applyAction(cur, action);
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
        set({
          online: game,
          onlineError: null,
          boardVisible: true,
          onlineBoards: {},
          onlineRequests: {},
        });
        get().startPolling();
        return game;
      },

      joinOnline: async (code, input) => {
        const game = await apiJoinGame(code.toUpperCase(), input);
        serverVersion = game.version;
        serverCode = game.code;
        set({
          online: game,
          onlineError: null,
          boardVisible: true,
          onlineBoards: {},
          onlineRequests: {},
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
            get().stopPolling();
            serverCode = null;
            set({ online: null, onlineError: 'Game ended.' });
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
          set({ onlineError: err instanceof Error ? err.message : 'Invalid action.' });
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
                    'Action lost a race — refreshed.',
                    null, // 409: silently ignore !fresh / fetch errors (poll will catch up)
                    set
                  );
                } else if (e.status === 403) {
                  await recoverFromServerState(
                    code,
                    e.message || 'Not allowed.',
                    e.message || 'Not allowed.',
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
                    e.message || 'Action failed.',
                    e.message || 'Action failed.',
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
          set({
            online: null,
            onlineError: null,
            boardVisible: true,
            onlineBoards: {},
            onlineRequests: {},
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
        set((s) => ({ history: s.history.filter((r) => r.id !== id) }));
      },
    }),
    {
      name: 'mtg-play',
      version: 1,
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
      // `history` (synced game records) is intentionally NOT in the partialize
      // list anymore — it lives in entity-store and is rehydrated by sync.ts.
      // Persisting it here would race the sync-driven setState on boot.
      partialize: (s) => ({
        local: s.local,
        online: s.online,
        boardVisible: s.boardVisible,
        hapticsEnabled: s.hapticsEnabled,
        preferredLayouts: s.preferredLayouts,
      }),
    }
  )
);

/**
 * Sync subscriber: every in-memory change to the play history flows through
 * the per-row sync layer. See store/collection.ts for the broader pattern.
 * `local` and `online` are intentionally NOT synced — local games are a
 * single-device session and online games are owned by the game_sessions
 * REST API (separate from the per-row user-data sync).
 */
usePlayStore.subscribe((state, prev) => {
  if (state.history === prev.history) return;
  // Synchronous guard — see store/collection.ts.
  if (isApplyingServer()) return;
  void import('../lib/sync')
    .then((sync) => sync.persistGamesState(state.history))
    // See store/cube.ts — a swallowed persist rejection is invisible data loss.
    .catch((err) => logger.warn('[store] Failed to persist game history:', err));
});

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
