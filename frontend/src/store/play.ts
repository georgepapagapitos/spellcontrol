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
  type CreateGameInput,
  type JoinGameInput,
} from '../lib/games-api';
import { setHapticsEnabled } from '../lib/haptics';
import { clearUndo } from '../lib/undo-stack';

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
      colorIdentity: [],
    })),
  };
}

interface PlayState {
  /** Active local (shared-device) game, if any. */
  local: GameState | null;
  /** Active online game subscription (host or joined), if any. */
  online: GameState | null;
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

  // ── Board visibility ────────────────────────────────────────────────────
  hideBoard(): void;
  showBoard(): void;
  setHaptics(enabled: boolean): void;
  /** Remember (or clear, with null) the default layout for `count` seats. */
  setPreferredLayout(count: number, layout: string | null): void;

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
      history: [],
      hydrated: false,
      onlineError: null,
      onlinePolling: false,
      boardVisible: true,
      hapticsEnabled: true,
      preferredLayouts: {},

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
        set({ online: game, onlineError: null, boardVisible: true });
        get().startPolling();
        return game;
      },

      joinOnline: async (code, input) => {
        const game = await apiJoinGame(code.toUpperCase(), input);
        serverVersion = game.version;
        serverCode = game.code;
        set({ online: game, onlineError: null, boardVisible: true });
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
          // Don't clobber an in-flight optimistic state: if we're flushing,
          // skip this update — the flusher will adopt the server's reply.
          if (flushPromise) return;
          // Only adopt if it's newer than what we have. With no pending actions,
          // server is authoritative. A null reply means the version matched —
          // nothing to do.
          if (fresh && pendingActions.length === 0 && fresh.version > serverVersion) {
            serverVersion = fresh.version;
            set({ online: fresh, onlineError: null });
            recordIfFinished(fresh, set);
          }
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
                  pendingActions = [];
                  try {
                    const fresh = await apiGetGame(code);
                    if (fresh) {
                      serverVersion = fresh.version;
                      set({ online: fresh, onlineError: 'Action lost a race — refreshed.' });
                    }
                  } catch {
                    /* surfaced via subsequent poll */
                  }
                } else if (e.status === 403) {
                  pendingActions = [];
                  try {
                    const fresh = await apiGetGame(code);
                    if (fresh) {
                      serverVersion = fresh.version;
                      set({ online: fresh, onlineError: e.message || 'Not allowed.' });
                    } else {
                      set({ onlineError: e.message || 'Not allowed.' });
                    }
                  } catch {
                    set({ onlineError: e.message || 'Not allowed.' });
                  }
                } else {
                  set({ onlineError: e.message || 'Action failed.' });
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
        clearUndo(cur.id);
        get().stopPolling();
        pendingActions = [];
        serverCode = null;
        serverVersion = 0;
        set({ online: null, onlineError: null, boardVisible: true });
      },

      clearOnline: () => {
        const cur = get().online;
        if (cur) clearUndo(cur.id);
        get().stopPolling();
        pendingActions = [];
        serverCode = null;
        serverVersion = 0;
        set({ online: null, onlineError: null, boardVisible: true });
      },

      startPolling: () => {
        // `pollVisibilityHandler` (not `pollTimer`) is the "already polling"
        // marker: while the tab is hidden the interval is torn down but the
        // subscription is still logically active.
        if (pollVisibilityHandler) return;
        set({ onlinePolling: true });

        const tick = () => void get().refreshOnline();
        // Reconcile the interval with the current visibility state: run it
        // while visible, tear it down (and do nothing) while hidden. `catchUp`
        // fires one immediate poll when an interval is (re)created — used on a
        // hidden→visible transition so a returning tab doesn't wait a full
        // interval, but skipped on the initial start (callers already hold
        // fresh state, or do their own first refresh).
        const ensureInterval = (catchUp: boolean) => {
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          if (hidden) {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          } else if (!pollTimer) {
            pollTimer = setInterval(tick, POLL_INTERVAL_MS);
            if (catchUp) tick();
          }
        };

        const sync = () => ensureInterval(true);
        pollVisibilityHandler = sync;
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', sync);
        }
        ensureInterval(false);
      },

      stopPolling: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (pollVisibilityHandler && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', pollVisibilityHandler);
        }
        pollVisibilityHandler = null;
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
  void import('../lib/sync').then((sync) => sync.persistGamesState(state.history)).catch(() => {});
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
