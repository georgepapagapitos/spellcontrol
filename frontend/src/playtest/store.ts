import { create } from 'zustand';
import {
  applyAction,
  createPlaytestState,
  type PlaytestAction,
  type PlaytestInit,
  type PlaytestState,
} from '@/lib/playtest';

/**
 * UI flow phase, separate from the game-state reducer.
 *  - `opening` — initial hand on screen; user can Keep or Mulligan.
 *  - `mulligan-bottom` — London mulligan: after N mulligans the user must
 *    send N cards from hand to the bottom of the library before play starts.
 *  - `playing` — normal play; no opening-hand UI.
 */
export type PlaytestPhase = 'opening' | 'mulligan-bottom' | 'playing';

interface PlaytestStore {
  state: PlaytestState | null;
  deckId: string | null;
  phase: PlaytestPhase;
  mulliganCount: number;
  init(deckId: string, init: PlaytestInit): void;
  dispatch(action: PlaytestAction): void;
  /** Advance from opening → either playing (no mulligans) or mulligan-bottom. */
  keepOpeningHand(): void;
  /** Reshuffle hand + library; increment mulligan count; stay on opening. */
  mulliganOpeningHand(): void;
  /** Finalize London-mulligan bottoms and start play. */
  finalizeBottom(cardIds: readonly string[]): void;
  teardown(): void;
}

export const usePlaytestStore = create<PlaytestStore>((set, get) => ({
  state: null,
  deckId: null,
  phase: 'opening',
  mulliganCount: 0,
  init(deckId, init) {
    set({
      deckId,
      state: createPlaytestState(init),
      phase: 'opening',
      mulliganCount: 0,
    });
  },
  dispatch(action) {
    const current = get().state;
    if (!current) return;
    const next = applyAction(current, action);
    // RESET drops us back to the opening hand flow with a fresh mulligan count.
    if (action.type === 'RESET') {
      set({ state: next, phase: 'opening', mulliganCount: 0 });
    } else {
      set({ state: next });
    }
  },
  keepOpeningHand() {
    const { mulliganCount } = get();
    set({ phase: mulliganCount > 0 ? 'mulligan-bottom' : 'playing' });
  },
  mulliganOpeningHand() {
    const current = get().state;
    if (!current) return;
    set({
      state: applyAction(current, { type: 'MULLIGAN' }),
      mulliganCount: get().mulliganCount + 1,
    });
  },
  finalizeBottom(cardIds) {
    let current = get().state;
    if (!current) return;
    // Each card moves to the bottom of the library (toIndex = library length).
    // Recompute the index between actions so successive sends append correctly.
    for (const cardId of cardIds) {
      current = applyAction(current, {
        type: 'MOVE_TO_ZONE',
        cardId,
        to: 'library',
        toIndex: current.zones.library.length,
      });
    }
    set({ state: current, phase: 'playing' });
  },
  teardown() {
    set({ state: null, deckId: null, phase: 'opening', mulliganCount: 0 });
  },
}));
