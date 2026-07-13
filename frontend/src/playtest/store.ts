import { create } from 'zustand';
import {
  applyAction,
  createPlaytestState,
  type PlaytestAction,
  type PlaytestInit,
  type PlaytestState,
} from '@/lib/playtest';
import { appendLogEntries, buildLogEntries, type GameLogEntry } from '@/lib/playtest/game-log';
import {
  fingerprintDeck,
  savePlaytestSnapshot,
  type PlaytestSnapshot,
} from '@/lib/playtest/session-snapshot';
import { useDecksStore } from '@/store/decks';
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
  /**
   * Turn-grouped event journal (E140) — a record of what happened, not
   * replayable state. Survives RESET (a "Game reset" entry marks the
   * boundary instead of clearing history); cleared on init/hydrate/teardown
   * since those start a genuinely different session.
   */
  gameLog: GameLogEntry[];
  init(deckId: string, init: PlaytestInit): void;
  /** Restore a previously-saved session in place of `init` (E137 resume). */
  hydrate(deckId: string, snapshot: PlaytestSnapshot): void;
  dispatch(action: PlaytestAction): void;
  /** Log a scry/peek (opening the top-of-library viewer) — not a reducer
   *  action, so it doesn't flow through `dispatch`. */
  logScryPeek(): void;
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
  gameLog: [],
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
      gameLog: [],
    });
  },
  hydrate(deckId, snapshot) {
    set({
      deckId,
      // `commanderTax` postdates the original snapshot shape (E139) — backfill
      // so a pre-existing localStorage session from before that change doesn't
      // crash the reducer the first time a commander leaves the command zone.
      state: { ...snapshot.state, commanderTax: snapshot.state.commanderTax ?? {}, past: [] },
      phase: snapshot.phase,
      mulliganCount: snapshot.mulliganCount,
      resistance: snapshot.resistance,
      resistanceState: snapshot.resistanceState,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
      gameLog: snapshot.gameLog ?? [],
    });
  },
  dispatch(action) {
    const current = get().state;
    if (!current) return;
    const next = applyAction(current, action);
    // RESET drops us back to the opening hand flow with a fresh mulligan count
    // (and, if Resistance is on, a fresh opponent for the fresh game). The log
    // itself is NOT cleared — a "Game reset" entry marks the boundary instead,
    // so the journal covers the whole session, resets included.
    if (action.type === 'RESET') {
      const { resistance, gameLog } = get();
      set({
        state: next,
        phase: 'opening',
        mulliganCount: 0,
        resistanceState: resistance ? createResistanceState(next.rngSeed) : null,
        resistancePast: [],
        lastResistanceEvent: null,
        gameLog: appendLogEntries(gameLog, [
          { turn: next.turn, kind: 'reset', text: 'Game reset' },
        ]),
      });
      return;
    }
    if (action.type === 'UNDO') {
      // Undo doesn't rewind the log — it's a journal of what happened,
      // undos included — it only appends a marker (when something was
      // actually popped; an empty `past` makes `next` === `current`).
      const { resistance, resistanceState, resistancePast, gameLog } = get();
      const undid = next !== current;
      const nextLog = undid
        ? appendLogEntries(gameLog, [{ turn: next.turn, kind: 'undo', text: 'Undid last action' }])
        : gameLog;
      if (resistance && resistanceState) {
        // Rewind the opponent alongside the board: the popped entry's paired
        // snapshot (seed included) means replaying re-rolls the same response.
        set({
          state: next,
          resistanceState: resistancePast[0] ?? resistanceState,
          resistancePast: resistancePast.slice(1),
          gameLog: nextLog,
        });
      } else {
        set({ state: next, gameLog: nextLog });
      }
      return;
    }
    const entries = buildLogEntries(current, action, next);
    const { resistance, resistanceState, resistancePast, gameLog } = get();
    if (resistance && resistanceState) {
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
      // The banner's message is the durable record verbatim — the log entry
      // and the toast text are the same string.
      const allEntries =
        result.message !== null
          ? [
              ...entries,
              { turn: result.state.turn, kind: 'resistance' as const, text: result.message },
            ]
          : entries;
      set({
        state: result.state,
        resistanceState: result.resistanceState,
        resistancePast: [...pairs, ...resistancePast].slice(0, result.state.past.length),
        gameLog: appendLogEntries(gameLog, allEntries),
        ...(result.message !== null && {
          lastResistanceEvent: { id: seq, message: result.message },
          resistanceEventSeq: seq,
        }),
      });
      return;
    }
    set({ state: next, gameLog: appendLogEntries(gameLog, entries) });
  },
  logScryPeek() {
    const { state, gameLog } = get();
    if (!state) return;
    set({
      gameLog: appendLogEntries(gameLog, [
        { turn: state.turn, kind: 'scry', text: 'Peeked at the top of the library' },
      ]),
    });
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
    const { resistanceState, resistancePast, gameLog } = get();
    set({
      state: next,
      mulliganCount: get().mulliganCount + 1,
      gameLog: appendLogEntries(gameLog, buildLogEntries(current, { type: 'MULLIGAN' }, next)),
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
      gameLog: [],
    });
  },
}));

/* ── E137: device-local session persistence ───────────────────────────────
 * Debounced snapshot-to-localStorage so a refresh/back-swipe/app-switch
 * doesn't lose an in-progress game. Snapshot content is captured at the
 * moment of each store change (so a subsequent `teardown()` — which nulls
 * `state`/`deckId` — can never clobber the last real snapshot with nothing);
 * only the localStorage *write* is debounced, coalescing rapid successive
 * dispatches into one write ~`SNAPSHOT_DEBOUNCE_MS` after the burst settles.
 */
const SNAPSHOT_DEBOUNCE_MS = 400;

function captureSnapshot(): { deckId: string; snapshot: PlaytestSnapshot } | null {
  const { state, deckId, phase, mulliganCount, resistance, resistanceState, gameLog } =
    usePlaytestStore.getState();
  if (!state || !deckId) return null;
  const deck = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!deck) return null;
  const { past: _past, ...rest } = state;
  return {
    deckId,
    snapshot: {
      fingerprint: fingerprintDeck(deck),
      savedAt: Date.now(),
      phase,
      mulliganCount,
      resistance,
      resistanceState,
      gameLog,
      state: rest,
    },
  };
}

let pendingSave: { deckId: string; snapshot: PlaytestSnapshot } | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

/** Immediately writes the last-captured snapshot, if any, and clears the
 *  pending debounce. Safe to call redundantly (e.g. from both a pagehide
 *  listener and a component's own unmount cleanup). */
export function flushPendingPlaytestSnapshot(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  if (pendingSave) {
    savePlaytestSnapshot(pendingSave.deckId, pendingSave.snapshot);
    pendingSave = null;
  }
}

if (typeof window !== 'undefined') {
  usePlaytestStore.subscribe((curr, prev) => {
    if (curr.state === prev.state) return;
    const captured = captureSnapshot();
    if (!captured) return; // e.g. teardown() — leave any prior pending save intact
    pendingSave = captured;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(flushPendingPlaytestSnapshot, SNAPSHOT_DEBOUNCE_MS);
  });
  // Capacitor/mobile Safari can suspend the tab before the debounce fires —
  // flush on both signals so backgrounding never loses the last few plays.
  window.addEventListener('pagehide', flushPendingPlaytestSnapshot);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPlaytestSnapshot();
  });
}
