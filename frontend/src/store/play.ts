import { create } from 'zustand';
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

const POLL_INTERVAL_MS = 2500;

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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
  }>;
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

  // ── Local game ──────────────────────────────────────────────────────────
  startLocal(setup: LocalGameSetup): void;
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
            startingLife: setup.startingLife,
            isHost: i === 0,
          })
        );
        const game = createGameState({
          id: newId('game'),
          code: '',
          mode: 'local',
          hostUserId: null,
          format: setup.format,
          startingLife: setup.startingLife,
          commanderDamageEnabled: setup.commanderDamageEnabled,
          poisonEnabled: setup.poisonEnabled,
          players,
        });
        const started = applyAction(game, { type: 'start' });
        set({ local: started });
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

      discardLocal: () => set({ local: null }),

      // ── Online ────────────────────────────────────────────────────────────
      hostOnline: async (input) => {
        const game = await apiCreateGame(input);
        serverVersion = game.version;
        serverCode = game.code;
        set({ online: game, onlineError: null });
        get().startPolling();
        return game;
      },

      joinOnline: async (code, input) => {
        const game = await apiJoinGame(code.toUpperCase(), input);
        serverVersion = game.version;
        serverCode = game.code;
        set({ online: game, onlineError: null });
        get().startPolling();
        return game;
      },

      refreshOnline: async () => {
        const code = serverCode;
        if (!code) return;
        try {
          const fresh = await apiGetGame(code);
          // Don't clobber an in-flight optimistic state: if we're flushing,
          // skip this update — the flusher will adopt the server's reply.
          if (flushPromise) return;
          // Only adopt if it's newer than what we have. With no pending actions,
          // server is authoritative.
          if (pendingActions.length === 0 && fresh.version > serverVersion) {
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
                  pendingActions = [];
                  try {
                    const fresh = await apiGetGame(code);
                    serverVersion = fresh.version;
                    set({ online: fresh, onlineError: 'Action lost a race — refreshed.' });
                  } catch {
                    /* surfaced via subsequent poll */
                  }
                } else if (e.status === 403) {
                  pendingActions = [];
                  try {
                    const fresh = await apiGetGame(code);
                    serverVersion = fresh.version;
                    set({ online: fresh, onlineError: e.message || 'Not allowed.' });
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
        get().stopPolling();
        pendingActions = [];
        serverCode = null;
        serverVersion = 0;
        set({ online: null, onlineError: null });
      },

      clearOnline: () => {
        get().stopPolling();
        pendingActions = [];
        serverCode = null;
        serverVersion = 0;
        set({ online: null, onlineError: null });
      },

      startPolling: () => {
        if (pollTimer) return;
        set({ onlinePolling: true });
        pollTimer = setInterval(() => {
          void get().refreshOnline();
        }, POLL_INTERVAL_MS);
      },

      stopPolling: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        set({ onlinePolling: false });
      },

      // ── History ───────────────────────────────────────────────────────────
      setHistory: (records) => set({ history: records }),
      removeHistory: (id) => set((s) => ({ history: s.history.filter((r) => r.id !== id) })),
    }),
    {
      name: 'mtg-play',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
      // Don't persist the live online subscription or polling flags — they're
      // re-established on demand.
      partialize: (s) => ({ local: s.local, history: s.history }),
    }
  )
);

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
