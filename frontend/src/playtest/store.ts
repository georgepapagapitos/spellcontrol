import { create } from 'zustand';
import {
  applyAction,
  createPlaytestState,
  type PlaytestAction,
  type PlaytestInit,
  type PlaytestState,
} from '@/lib/playtest';
import { applyResistance, createResistanceState, type ResistanceState } from './lib/resistance';

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
  /** "Resistance" mode — a simulated opponent that responds to plays. */
  resistance: boolean;
  resistanceState: ResistanceState | null;
  /**
   * Opponent bookkeeping snapshots aligned entry-for-entry with
   * `state.past` (newest first, same cap): `resistancePast[i]` is the
   * ResistanceState that was in effect when `past[i]` was the present.
   * UNDO restores both together — otherwise undoing a response leaves
   * `respondedThisTurn`/`wipeUsed` set for a response that visually never
   * happened (and the once-per-game wipe could never fire again).
   */
  resistancePast: ResistanceState[];
  /** Latest opponent announcement; `id` increments so repeats re-announce. */
  lastResistanceEvent: { id: number; message: string } | null;
  /** Monotonic announcement counter — deliberately NOT reset by RESET or
   *  toggling, so a dismissed banner id from a prior game can't collide with
   *  (and swallow) the fresh game's first announcement. */
  resistanceEventSeq: number;
  init(deckId: string, init: PlaytestInit): void;
  dispatch(action: PlaytestAction): void;
  toggleResistance(): void;
  /** Advance from opening → either playing (no mulligans) or mulligan-bottom. */
  keepOpeningHand(): void;
  /** Reshuffle hand + library; increment mulligan count; stay on opening. */
  mulliganOpeningHand(): void;
  /** Finalize London-mulligan bottoms and start play. */
  finalizeBottom(cardIds: readonly string[]): void;
  teardown(): void;
}

/** How many history entries `newPast` gained over `oldPast` (both newest-first;
 *  `slice` keeps entry identity, so the old head is our anchor). */
function pushedEntries(oldPast: readonly unknown[], newPast: readonly unknown[]): number {
  if (oldPast.length === 0) return newPast.length;
  const idx = newPast.indexOf(oldPast[0]);
  return idx === -1 ? newPast.length : idx;
}

export const usePlaytestStore = create<PlaytestStore>((set, get) => ({
  state: null,
  deckId: null,
  phase: 'opening',
  mulliganCount: 0,
  resistance: false,
  resistanceState: null,
  resistancePast: [],
  lastResistanceEvent: null,
  resistanceEventSeq: 0,
  init(deckId, init) {
    set({
      deckId,
      state: createPlaytestState(init),
      phase: 'opening',
      mulliganCount: 0,
      resistance: false,
      resistanceState: null,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
    });
  },
  dispatch(action) {
    const current = get().state;
    if (!current) return;
    const next = applyAction(current, action);
    // RESET drops us back to the opening hand flow with a fresh mulligan count
    // (and, if Resistance is on, a fresh opponent for the fresh game).
    if (action.type === 'RESET') {
      const { resistance } = get();
      set({
        state: next,
        phase: 'opening',
        mulliganCount: 0,
        resistanceState: resistance ? createResistanceState(next.rngSeed) : null,
        resistancePast: [],
        lastResistanceEvent: null,
      });
      return;
    }
    const { resistance, resistanceState, resistancePast } = get();
    if (resistance && resistanceState) {
      if (action.type === 'UNDO') {
        // Rewind the opponent alongside the board: the popped entry's paired
        // snapshot (seed included) means replaying re-rolls the same response.
        set({
          state: next,
          resistanceState: resistancePast[0] ?? resistanceState,
          resistancePast: resistancePast.slice(1),
        });
        return;
      }
      const result = applyResistance(resistanceState, current, next, action);
      // Pair each new history entry with its before-state bookkeeping: the
      // player's action and the opponent's first move both predate the
      // response decision; later wipe moves carry the post-decision flags so
      // a partial undo doesn't un-spend the wipe.
      const pushed = pushedEntries(current.past, result.state.past);
      const pairs: ResistanceState[] =
        pushed <= 2
          ? Array<ResistanceState>(pushed).fill(resistanceState)
          : [
              ...Array<ResistanceState>(pushed - 2).fill(result.resistanceState),
              resistanceState,
              resistanceState,
            ];
      const seq = get().resistanceEventSeq + 1;
      set({
        state: result.state,
        resistanceState: result.resistanceState,
        resistancePast: [...pairs, ...resistancePast].slice(0, result.state.past.length),
        ...(result.message !== null && {
          lastResistanceEvent: { id: seq, message: result.message },
          resistanceEventSeq: seq,
        }),
      });
      return;
    }
    set({ state: next });
  },
  toggleResistance() {
    const { resistance, state } = get();
    if (resistance) {
      set({
        resistance: false,
        resistanceState: null,
        resistancePast: [],
        lastResistanceEvent: null,
      });
    } else {
      // Seed from the game's rngSeed when available so a seeded session gets a
      // deterministic opponent; Date.now() is a fine fallback (app code).
      const fresh = createResistanceState(state?.rngSeed ?? Date.now());
      set({
        resistance: true,
        resistanceState: fresh,
        // Pre-toggle history entries pair with the fresh opponent: undoing
        // into them keeps `state.past`/`resistancePast` aligned.
        resistancePast: Array<ResistanceState>(state?.past.length ?? 0).fill(fresh),
      });
    }
  },
  keepOpeningHand() {
    const { mulliganCount } = get();
    set({ phase: mulliganCount > 0 ? 'mulligan-bottom' : 'playing' });
  },
  mulliganOpeningHand() {
    const current = get().state;
    if (!current) return;
    const next = applyAction(current, { type: 'MULLIGAN' });
    const { resistanceState, resistancePast } = get();
    set({
      state: next,
      mulliganCount: get().mulliganCount + 1,
      // Keep resistancePast aligned if Resistance was toggled on pre-play.
      ...(resistanceState && {
        resistancePast: [
          ...Array<ResistanceState>(pushedEntries(current.past, next.past)).fill(resistanceState),
          ...resistancePast,
        ].slice(0, next.past.length),
      }),
    });
  },
  finalizeBottom(cardIds) {
    let current = get().state;
    if (!current) return;
    const before = current;
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
    const { resistanceState, resistancePast } = get();
    set({
      state: current,
      phase: 'playing',
      ...(resistanceState && {
        resistancePast: [
          ...Array<ResistanceState>(pushedEntries(before.past, current.past)).fill(resistanceState),
          ...resistancePast,
        ].slice(0, current.past.length),
      }),
    });
  },
  teardown() {
    set({
      state: null,
      deckId: null,
      phase: 'opening',
      mulliganCount: 0,
      resistance: false,
      resistanceState: null,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
    });
  },
}));
