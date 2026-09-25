import { create } from 'zustand';
import {
  applyAction,
  createPlaytestState,
  type PlaytestAction,
  type PlaytestCard,
  type PlaytestInit,
  type PlaytestState,
} from '@/lib/playtest';
import { cardsToBottom, type MulliganType } from '@/lib/game-state';
import { appendLogEntries, buildLogEntries, type GameLogEntry } from '@/lib/playtest/game-log';
import { classifyAction } from '@/lib/playtest/rewind';
import {
  loadTakebackMode,
  saveTakebackMode,
  trailEntry,
  type RewindTrailEntry,
  type TakebackMode,
} from './lib/takeback';
import type { PrintedBodies } from './lib/printed-bodies';
import {
  fingerprintDeck,
  backfillManaCost,
  migrateSnapshotState,
  savePlaytestSnapshot,
  type PlaytestSnapshot,
} from '@/lib/playtest/session-snapshot';
import {
  buildLandNameSet,
  computeSessionAggregates,
  deriveSessionRecord,
  isMeaningfulSession,
  type PlaytestSessionRecord,
  type SessionAggregates,
} from '@/lib/playtest/session-record';
import { appendSessionRecord } from '@/lib/playtest/session-history';
import { useDecksStore, type Deck } from '@/store/decks';
import {
  applyResistance,
  createResistanceState,
  RESISTANCE_LEVEL_ANNOUNCE,
  RESISTANCE_PRESETS,
  saveLastResistanceLevel,
  type ResistanceConfig,
  type ResistanceLevel,
  type ResistanceState,
} from './lib/resistance';
import {
  hordeCreatureIds,
  isHordeTurnDue,
  type SoloHordeConfig,
  type SoloHordeState,
} from './lib/horde-solo';
import {
  attackSummary,
  bossesCrossed,
  buildHordeLibrary,
  hordeOutcome,
  hordeTurnActions,
  loadHordeDeck,
  millForDamage,
  planHordeTurn,
  resolveActions,
  resolveHordeSettings,
  type HordeBossArrival,
  type HordeLevel,
  type HordeReveal,
  type HordeSettings,
} from '@/lib/horde';
import { autoPlace, type Rect } from './lib/auto-place';

function configFor(level: ResistanceLevel): ResistanceConfig | null {
  return level === 'off' ? null : RESISTANCE_PRESETS[level];
}

/**
 * Derives + persists a `PlaytestSessionRecord` (E141) for `deckId`'s history,
 * if the session was meaningfully played — a no-op (returns null) otherwise.
 * Exported so `PlaytestPage` can call it for the one trigger the store can't
 * see itself: a resume-worthy localStorage snapshot the player declines in
 * favor of "Start fresh" (the store never loads that state into `state`).
 */
export function tryRecordSession(
  deckId: string | null,
  state: Omit<PlaytestState, 'past'> | null,
  gameLog: readonly GameLogEntry[],
  mulliganCount: number,
  resistance: boolean,
  /**
   * The deck being played, when it isn't one of the viewer's own — a shared or
   * public deck goldfished at /d/:slug/playtest. Without it the decks-store
   * lookup below misses and the record loses its land set and deck size, so
   * every derived stat (lands in opener, mana screw) reads as if the deck had
   * no lands. Omit for your own decks; the store lookup is correct there.
   */
  deckOverride?: Deck,
  /** Set when a solo Horde was armed at any point during the session
   *  (E387 PR 5) — attaches its outcome to the record. */
  horde?: SoloHordeState | null
): { record: PlaytestSessionRecord; aggregates: SessionAggregates } | null {
  if (!deckId || !state || !isMeaningfulSession(state)) return null;
  const deck = deckOverride ?? useDecksStore.getState().decks.find((d) => d.id === deckId);
  const landNames = buildLandNameSet(deck);
  const record = deriveSessionRecord({
    deckId,
    log: gameLog,
    state,
    mulliganCount,
    resistance,
    deckSize: deck ? deck.cards.length : null,
    isLandName: (name) => landNames.has(name),
    horde,
  });
  const updated = appendSessionRecord(deckId, record);
  return { record, aggregates: computeSessionAggregates(updated) };
}

/**
 * UI flow phase, separate from the game-state reducer.
 *  - `opening` — initial hand on screen; user can Keep or Mulligan.
 *  - `mulligan-bottom` — London mulligan: after N mulligans the user must
 *    send N cards from hand to the bottom of the library before play starts.
 *    Skipped entirely under the free-mulligan variant (E226).
 *  - `playing` — normal play; no opening-hand UI.
 */
export type PlaytestPhase = 'opening' | 'mulligan-bottom' | 'playing';

/* ── Free-mulligan variant (E226) ─────────────────────────────────────────
 * A casual house rule (and how most goldfishing is actually done): every
 * mulligan redraws a full seven with no cards sent to the bottom. It's a way
 * you play, not a property of one game, so it's remembered per device the
 * same way the Resistance level is — a player who always goldfishes on free
 * mulligans shouldn't re-arm it every session. Deliberately NOT in the
 * session snapshot: the device preference is the single source of truth, so
 * a resumed game can't disagree with the toggle the player is looking at. */
const FREE_MULLIGAN_KEY = 'spellcontrol:playtest:freeMulligan';

/** Which variant actually governs this board: the online table's rule when
 *  seated, else this device's own free-mulligan preference (whose "off" has
 *  always meant London — solo's behaviour is unchanged by the table setting
 *  existing). */
export function effectiveMulliganType(
  freeMulligan: boolean,
  tableMulliganType: MulliganType | null
): MulliganType {
  return tableMulliganType ?? (freeMulligan ? 'free' : 'london');
}

export function loadFreeMulligan(): boolean {
  try {
    return localStorage.getItem(FREE_MULLIGAN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveFreeMulligan(on: boolean): void {
  try {
    localStorage.setItem(FREE_MULLIGAN_KEY, on ? '1' : '0');
  } catch {
    /* best-effort — storage unavailable/full */
  }
}

interface PlaytestStore {
  state: PlaytestState | null;
  deckId: string | null;
  /**
   * The deck being played, when it is NOT one of the viewer's own — a shared or
   * public deck goldfished at `/d/:slug/playtest`. `tryRecordSession` resolves
   * the deck from the decks store by id, which misses for these, and the
   * session record then loses its land set and deck size (every derived stat —
   * lands in opener, mana screw — reads as if the deck had no lands). Set by
   * `init`/`hydrate`, cleared on teardown. Null for your own decks, where the
   * store lookup is correct.
   */
  externalDeck: Deck | null;
  phase: PlaytestPhase;
  mulliganCount: number;
  /** Free-mulligan variant: mulligans redraw a full seven and the
   *  bottom-N step is skipped. Device preference — see `loadFreeMulligan`. */
  freeMulligan: boolean;
  /** The mulligan variant the ONLINE table agreed on, or null when playing
   *  solo. A rule the pod set beats this device's own free-mulligan taste,
   *  so when it is set it decides the bottom-N count outright
   *  (`effectiveMulliganType`). Per-session, not persisted: it is the
   *  table's fact, re-read from the table every time. */
  tableMulliganType: MulliganType | null;
  /** On-the-draw choice (Wave 3): `createPlaytestState` deals a fresh seven
   *  with `turn: 1` and no draw — that IS "on the play", the correct default
   *  for solo goldfishing. This flag is the other half: draw one extra card
   *  the moment play actually begins, via the normal DRAW action (so it's
   *  logged and undoable like any other draw) rather than a reducer-level
   *  branch. Per-game, not a device preference — reset on every init/hydrate. */
  onDraw: boolean;
  /** "Resistance" mode — a simulated opponent that responds to plays.
   *  'off' disables it; the other three levels are difficulty presets (E142). */
  resistanceLevel: ResistanceLevel;
  resistanceState: ResistanceState | null;
  /**
   * Opponent bookkeeping snapshots aligned entry-for-entry with
   * `state.past` (newest first, same cap): `resistancePast[i]` is the
   * ResistanceState that was in effect when `past[i]` was the present.
   * UNDO restores both together — otherwise undoing a response leaves
   * `responsesThisTurn`/`wipesUsed` set for a response that visually never
   * happened (and a spent wipe could never fire again).
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
  /**
   * Rewind classification, one entry per `state.past` push, newest first —
   * the same lifecycle as `resistancePast` (reset on RESET/init/hydrate/
   * teardown, popped on UNDO). Unlike `gameLog`, this is a complete 1:1
   * mirror of the undo stack — see lib/takeback.ts's module doc for why the
   * journal alone isn't enough. Consumed by `useTakeback`.
   */
  rewindTrail: RewindTrailEntry[];
  /** Table takeback rule: Ask (default) / Free / Off — device preference,
   *  same pattern as `freeMulligan`. NOT reset by init/hydrate/teardown. */
  /** null until the player picks one — `resolveTakebackMode` fills it. */
  takebackMode: TakebackMode | null;
  /** Solo Horde (E387 PR 5): the self-running horde beside your board, or
   *  null. See `lib/horde-solo.ts`. */
  horde: SoloHordeState | null;
  /** Aligned entry-for-entry with `state.past`, like `resistancePast`. */
  hordePast: (SoloHordeState | null)[];
  hordeLoad: {
    status: 'idle' | 'loading' | 'error';
    error: string | null;
    pending: { hordeId: string; level: HordeLevel; overrides: Partial<HordeSettings> } | null;
  };
  /** Most recently captured session record (Reset, teardown, or
   *  replaced-by-init), for the end-of-session summary. Null once a fresh
   *  session starts with nothing yet to report. */
  lastSessionRecord: PlaytestSessionRecord | null;
  /** Aggregates snapshot at the moment `lastSessionRecord` was captured, for
   *  the summary's "vs your average" line. */
  init(deckId: string, init: PlaytestInit, externalDeck?: Deck): void;
  /** Restore a previously-saved session in place of `init` (E137 resume). */
  hydrate(deckId: string, snapshot: PlaytestSnapshot, externalDeck?: Deck): void;
  dispatch(action: PlaytestAction): void;
  /** Fill in printed power/toughness on cards whose deck copy carries none.
   *  Data repair, not a move: it never goes through the reducer, so it writes
   *  no undo entry and no game-log line. See `lib/printed-bodies.ts`. */
  applyPrintedBodies(bodies: PrintedBodies): void;
  /** Switch difficulty (or turn it off); persists the choice as the device's
   *  "last used" preference and appends a game-log entry when armed. */
  setResistanceLevel(level: ResistanceLevel): void;
  /** Turn the free-mulligan variant on/off; persists as a device preference. */
  setFreeMulligan(on: boolean): void;
  setTableMulliganType(type: MulliganType | null): void;
  /** Switch the table takeback rule; persists as a device preference. */
  setTakebackMode(mode: TakebackMode): void;
  /** Turn the on-the-draw choice on/off for this game. */
  setOnDraw(on: boolean): void;
  /** Advance from opening → either playing (no mulligans taken, or the
   *  free-mulligan variant) or mulligan-bottom. */
  keepOpeningHand(): void;
  /** Reshuffle hand + library; increment mulligan count; stay on opening. */
  mulliganOpeningHand(): void;
  /** Finalize London-mulligan bottoms and start play. */
  finalizeBottom(cardIds: readonly string[]): void;
  teardown(): void;
  armHorde(hordeId: string, level: HordeLevel, overrides?: Partial<HordeSettings>): Promise<void>;
  retryHordeLoad(): void;
  disarmHorde(): void;
  startHordeTurn(rect?: Rect | null): void;
  confirmHordeReveal(): void;
  resolveHordeAttack(damage: number): void;
  damageHorde(amount: number, rect?: Rect | null): void;
  clearHordeDamageResult(): void;
  moveHordeCard(cardId: string, to: 'graveyard' | 'exile' | 'library'): void;
}

/** How many history entries `newPast` gained over `oldPast` (both newest-first;
 *  `slice` keeps entry identity, so the old head is our anchor). */
function pushedEntries(oldPast: readonly unknown[], newPast: readonly unknown[]): number {
  if (oldPast.length === 0) return newPast.length;
  const idx = newPast.indexOf(oldPast[0]);
  return idx === -1 ? newPast.length : idx;
}

/* ── Solo Horde (E387 PR 5) ────────────────────────────────────────────────
 * The horde is a second `PlaytestState` (`horde.board`) driven by the same
 * reducer, held beside yours. Its own history lives in `hordePast`, aligned
 * entry-for-entry with YOUR `state.past` — see the interface doc above and
 * `resistancePast` for the established pattern this mirrors. */

/** Mirrors `reducer.ts`'s own cap — a horde step's forced history push has
 *  to obey the same ceiling as every other undo entry. */
const MAX_UNDO_STACK = 50;

const HORDE_TRAIL_REASON = 'Solo horde bookkeeping. Nothing else at the table to ask.';

function snapshotYourState(state: PlaytestState): Omit<PlaytestState, 'past'> {
  const { past: _past, ...rest } = state;
  return rest;
}

/** Pushes ONE entry onto `state.past` with no field changes — how a horde
 *  step (a reveal, an attack summary, damage, arming at unchanged life…)
 *  rides the same undo stack as an ordinary dispatch even though nothing on
 *  YOUR board actually moved. */
function pushHordeEntry(state: PlaytestState): PlaytestState {
  const past = [snapshotYourState(state), ...state.past].slice(0, MAX_UNDO_STACK);
  return { ...state, past };
}

/** Applies the horde's damage (if any) then passes your turn, collapsed into
 *  ONE history entry — undo has to land back on the attack/reveal, not on a
 *  half-finished step in between the two actions. */
function finishHordeTurn(state: PlaytestState, damage: number): PlaytestState {
  const withDamage =
    damage !== 0 ? applyAction(state, { type: 'ADJUST_LIFE', delta: -damage }) : state;
  const withTurn = applyAction(withDamage, { type: 'NEXT_TURN' });
  return withDamage === state ? withTurn : { ...withTurn, past: withTurn.past.slice(1) };
}

function hordeOutcomeText(outcome: 'won' | 'lost'): string {
  return outcome === 'won' ? 'The horde is defeated' : 'You are defeated';
}

/** The store-field patch every horde step applies: the pushed state, the new
 *  horde value, `hordePast` kept aligned with `state.past` (`hordeBefore` is
 *  what a single undo restores), and the step's own log + rewind-trail
 *  entries. Shared by every action below so the alignment bookkeeping lives
 *  in exactly one place. */
function hordeStepUpdate(
  pushedState: PlaytestState,
  beforePast: readonly Omit<PlaytestState, 'past'>[],
  hordeBefore: SoloHordeState | null,
  hordePast: readonly (SoloHordeState | null)[],
  hordeAfter: SoloHordeState | null,
  gameLog: readonly GameLogEntry[],
  lines: ReadonlyArray<Omit<GameLogEntry, 'seq'>>,
  rewindTrail: readonly RewindTrailEntry[]
): Pick<PlaytestStore, 'state' | 'horde' | 'hordePast' | 'gameLog' | 'rewindTrail'> {
  const pushed = pushedEntries(beforePast, pushedState.past);
  return {
    state: pushedState,
    horde: hordeAfter,
    hordePast: [...Array<SoloHordeState | null>(pushed).fill(hordeBefore), ...hordePast].slice(
      0,
      pushedState.past.length
    ),
    gameLog: appendLogEntries(gameLog, lines),
    rewindTrail: [
      trailEntry({ verdict: 'free', reason: HORDE_TRAIL_REASON }, lines[0]?.text ?? null),
      ...rewindTrail,
    ].slice(0, pushedState.past.length),
  };
}

/** Shared by `disarmHorde()` and `setResistanceLevel()` (mutually exclusive
 *  with a horde) — pushes one undoable entry and clears `horde`. `null` when
 *  there is nothing armed to disarm. */
function disarmHordePatch(
  store: Pick<PlaytestStore, 'state' | 'horde' | 'hordePast' | 'gameLog' | 'rewindTrail'>
): Pick<PlaytestStore, 'state' | 'horde' | 'hordePast' | 'gameLog' | 'rewindTrail'> | null {
  const { state, horde, hordePast, gameLog, rewindTrail } = store;
  if (!state || !horde) return null;
  const withPush = pushHordeEntry(state);
  return hordeStepUpdate(
    withPush,
    state.past,
    horde,
    hordePast,
    null,
    gameLog,
    [{ turn: withPush.turn, kind: 'horde', text: 'The horde is dismissed' }],
    rewindTrail
  );
}

/** Bumped by `init`/`hydrate`/`teardown`, and by `armHorde` itself before it
 *  starts loading — a later async completion whose generation no longer
 *  matches (the session was torn down, replaced, or another arm started)
 *  must not apply. */
let hordeSessionGen = 0;

export const usePlaytestStore = create<PlaytestStore>((set, get) => ({
  state: null,
  deckId: null,
  externalDeck: null,
  phase: 'opening',
  mulliganCount: 0,
  freeMulligan: loadFreeMulligan(),
  tableMulliganType: null,
  onDraw: false,
  resistanceLevel: 'off',
  resistanceState: null,
  resistancePast: [],
  lastResistanceEvent: null,
  resistanceEventSeq: 0,
  gameLog: [],
  rewindTrail: [],
  takebackMode: loadTakebackMode(),
  lastSessionRecord: null,
  horde: null,
  hordePast: [],
  hordeLoad: { status: 'idle', error: null, pending: null },
  async armHorde(hordeId, level, overrides = {}) {
    const gen = ++hordeSessionGen;
    set({ hordeLoad: { status: 'loading', error: null, pending: { hordeId, level, overrides } } });
    let def;
    try {
      def = await loadHordeDeck(hordeId);
    } catch (err) {
      if (hordeSessionGen !== gen) return; // torn down / replaced / superseded while loading
      set({
        hordeLoad: {
          status: 'error',
          error: err instanceof Error ? err.message : "Couldn't load that horde.",
          pending: { hordeId, level, overrides },
        },
      });
      return;
    }
    if (hordeSessionGen !== gen) return; // torn down / replaced / superseded while loading
    const { state, gameLog, hordePast, rewindTrail, resistanceLevel } = get();
    if (!state) {
      set({ hordeLoad: { status: 'idle', error: null, pending: null } });
      return;
    }
    const settings = resolveHordeSettings(level, 1, overrides);
    const { library, bosses, seed } = buildHordeLibrary(def, settings, state.rngSeed);
    const board = createPlaytestState({ library, command: bosses, seed, openingHandSize: 0 });
    const config: SoloHordeConfig = { hordeId, hordeName: def.name, level, overrides, settings };
    const horde: SoloHordeState = {
      config,
      board,
      librarySizeAtStart: library.length,
      bossTicksCrossed: [],
      armedAtTurn: state.turn,
      hordeTurn: 0,
      phase: 'waiting',
      pendingReveal: null,
      pendingAttack: null,
      attackingIds: [],
      lastDamageResult: null,
      outcome: null,
      damageTaken: 0,
      cardsMilledByDamage: 0,
    };
    const delta = settings.life - state.life;
    const withLife =
      delta !== 0 ? applyAction(state, { type: 'ADJUST_LIFE', delta }) : pushHordeEntry(state);
    const text = `The horde arrives. Your life: ${state.life} → ${settings.life}`;
    set({
      ...hordeStepUpdate(
        withLife,
        state.past,
        null,
        hordePast,
        horde,
        gameLog,
        [{ turn: withLife.turn, kind: 'horde', text }],
        rewindTrail
      ),
      hordeLoad: { status: 'idle', error: null, pending: null },
      // Mutually exclusive with Resistance — arming while it's on turns it
      // off. Its own "Resistance: Off" announcement would double up with the
      // arrival line above, so this skips that log line on purpose.
      ...(resistanceLevel !== 'off' && {
        resistanceLevel: 'off' as const,
        resistanceState: null,
        resistancePast: [],
      }),
    });
  },
  retryHordeLoad() {
    const pending = get().hordeLoad.pending;
    if (!pending) return;
    void get().armHorde(pending.hordeId, pending.level, pending.overrides);
  },
  disarmHorde() {
    const patch = disarmHordePatch(get());
    if (patch) set(patch);
  },
  startHordeTurn(rect) {
    const { state, horde, gameLog, hordePast, rewindTrail } = get();
    if (!state || !horde) return;
    if (horde.phase !== 'waiting' || !isHordeTurnDue(horde, state.turn)) return;
    const nextHordeTurn = horde.hordeTurn + 1;
    const board = horde.board;
    const hordeArtifacts = board.battlefield.filter((b) =>
      (b.card.typeLine ?? '').toLowerCase().includes('artifact')
    ).length;
    const { revealed } = planHordeTurn(
      board.zones.library,
      horde.config.settings,
      nextHordeTurn,
      hordeArtifacts
    );
    const withPush = pushHordeEntry(state);
    const commit = (nextHorde: SoloHordeState, text: string) =>
      set(
        hordeStepUpdate(
          withPush,
          state.past,
          horde,
          hordePast,
          nextHorde,
          gameLog,
          [{ turn: state.turn, kind: 'horde', text }],
          rewindTrail
        )
      );

    if (revealed.length === 0) {
      // Empty library: attacks with whatever it already controls. Library
      // empty + no creatures is exactly `hordeOutcome`'s win condition, so
      // "nothing to attack with" here always means the fight is over.
      const attackingIds = hordeCreatureIds(board);
      const outcome = hordeOutcome(board, state.life);
      if (outcome) {
        commit(
          {
            ...horde,
            hordeTurn: nextHordeTurn,
            phase: 'ended',
            pendingReveal: null,
            attackingIds: [],
            pendingAttack: null,
            outcome,
          },
          hordeOutcomeText(outcome)
        );
        return;
      }
      const pendingAttack = attackSummary(board.battlefield);
      commit(
        {
          ...horde,
          hordeTurn: nextHordeTurn,
          phase: 'combat',
          pendingReveal: null,
          attackingIds,
          pendingAttack,
        },
        `The horde's library is empty. It attacks: ${pendingAttack.attackers} creatures, ${pendingAttack.power} power`
      );
      return;
    }

    const { toBattlefield, toResolve } = hordeTurnActions(revealed, board.battlefield, rect);
    const lastNontoken = [...revealed].reverse().find((c) => !c.isToken);
    const waveEndId = lastNontoken?.id ?? revealed[revealed.length - 1]?.id ?? null;
    const pendingReveal: HordeReveal = { revealed, toBattlefield, toResolve, waveEndId };
    commit(
      { ...horde, hordeTurn: nextHordeTurn, phase: 'reveal', pendingReveal },
      `The horde reveals ${revealed.length} card${revealed.length === 1 ? '' : 's'}`
    );
  },
  confirmHordeReveal() {
    const { state, horde, gameLog, hordePast, rewindTrail } = get();
    if (!state || !horde || horde.phase !== 'reveal' || !horde.pendingReveal) return;
    const { toBattlefield, toResolve } = horde.pendingReveal;
    let board = horde.board;
    for (const action of toBattlefield) board = applyAction(board, action);
    for (const action of resolveActions(toResolve)) board = applyAction(board, action);
    const outcome = hordeOutcome(board, state.life);

    if (outcome) {
      const withPush = pushHordeEntry(state);
      set(
        hordeStepUpdate(
          withPush,
          state.past,
          horde,
          hordePast,
          {
            ...horde,
            board,
            phase: 'ended',
            pendingReveal: null,
            attackingIds: [],
            pendingAttack: null,
            outcome,
          },
          gameLog,
          [{ turn: state.turn, kind: 'horde', text: hordeOutcomeText(outcome) }],
          rewindTrail
        )
      );
      return;
    }

    const attackingIds = hordeCreatureIds(board);
    if (attackingIds.length === 0) {
      // Nothing landed that can attack — the horde's turn passes at once.
      const finished = finishHordeTurn(state, 0);
      const lines = [
        { turn: state.turn, kind: 'horde' as const, text: 'The horde has nothing to attack with' },
        ...buildLogEntries(state, { type: 'NEXT_TURN' }, finished),
      ];
      set(
        hordeStepUpdate(
          finished,
          state.past,
          horde,
          hordePast,
          {
            ...horde,
            board,
            phase: 'waiting',
            pendingReveal: null,
            attackingIds: [],
            pendingAttack: null,
          },
          gameLog,
          lines,
          rewindTrail
        )
      );
      return;
    }

    const pendingAttack = attackSummary(board.battlefield);
    const withPush = pushHordeEntry(state);
    set(
      hordeStepUpdate(
        withPush,
        state.past,
        horde,
        hordePast,
        { ...horde, board, phase: 'combat', pendingReveal: null, attackingIds, pendingAttack },
        gameLog,
        [
          {
            turn: state.turn,
            kind: 'horde',
            text: `The horde attacks: ${pendingAttack.attackers} creatures, ${pendingAttack.power} power`,
          },
        ],
        rewindTrail
      )
    );
  },
  resolveHordeAttack(damage) {
    const { state, horde, gameLog, hordePast, rewindTrail } = get();
    if (!state || !horde || horde.phase !== 'combat') return;
    const dealt = Math.max(0, Math.floor(damage));
    const pendingAttack = horde.pendingAttack;
    const finished = finishHordeTurn(state, dealt);
    const outcome = hordeOutcome(horde.board, finished.life);
    const nextHorde: SoloHordeState = {
      ...horde,
      phase: outcome ? 'ended' : 'waiting',
      attackingIds: [],
      pendingAttack: null,
      damageTaken: horde.damageTaken + dealt,
      outcome,
    };
    const attackText = pendingAttack
      ? `The horde attacks: ${pendingAttack.attackers} creature${pendingAttack.attackers === 1 ? '' : 's'}, ${pendingAttack.power} power. You took ${dealt}`
      : `You took ${dealt}`;
    const lines = [
      { turn: state.turn, kind: 'horde' as const, text: attackText },
      ...buildLogEntries(state, { type: 'NEXT_TURN' }, finished),
      ...(outcome
        ? [{ turn: finished.turn, kind: 'horde' as const, text: hordeOutcomeText(outcome) }]
        : []),
    ];
    set(
      hordeStepUpdate(
        finished,
        state.past,
        horde,
        hordePast,
        nextHorde,
        gameLog,
        lines,
        rewindTrail
      )
    );
  },
  damageHorde(amount, rect) {
    const { state, horde, gameLog, hordePast, rewindTrail } = get();
    if (!state || !horde || horde.phase === 'ended') return;
    const clamped = Math.max(0, Math.floor(amount));
    const before = horde.board.zones.library.length;
    let board = applyAction(horde.board, millForDamage(clamped));
    const after = board.zones.library.length;
    const movedCount = before - after;
    const milled = board.zones.graveyard.slice(board.zones.graveyard.length - movedCount);

    const crossed = bossesCrossed(
      horde.librarySizeAtStart,
      before,
      after,
      horde.config.settings.bossTicks
    ).filter((i) => !horde.bossTicksCrossed.includes(i));
    const bossesEntered: HordeBossArrival[] = [];
    for (const tickIndex of crossed) {
      const boss = board.zones.command[0];
      if (!boss) continue;
      const { x, y } = autoPlace(boss, board.battlefield, rect);
      board = applyAction(board, { type: 'MOVE_TO_BATTLEFIELD', cardId: boss.id, x, y });
      bossesEntered.push({ name: boss.name, tick: horde.config.settings.bossTicks[tickIndex] });
    }

    const outcome = hordeOutcome(board, state.life);
    const nextHorde: SoloHordeState = {
      ...horde,
      board,
      bossTicksCrossed: [...horde.bossTicksCrossed, ...crossed],
      lastDamageResult: { amount: clamped, before, after, milled, bossesEntered },
      cardsMilledByDamage: horde.cardsMilledByDamage + milled.length,
      outcome,
      phase: outcome ? 'ended' : horde.phase,
    };
    const withPush = pushHordeEntry(state);
    const lines: Array<Omit<GameLogEntry, 'seq'>> = [
      {
        turn: state.turn,
        kind: 'horde',
        text: `The horde took ${clamped} damage. Milled ${milled.length}`,
      },
      ...bossesEntered.map((b) => ({
        turn: state.turn,
        kind: 'horde' as const,
        text: `${b.name} joins the horde`,
      })),
      ...(outcome
        ? [{ turn: state.turn, kind: 'horde' as const, text: hordeOutcomeText(outcome) }]
        : []),
    ];
    set(
      hordeStepUpdate(
        withPush,
        state.past,
        horde,
        hordePast,
        nextHorde,
        gameLog,
        lines,
        rewindTrail
      )
    );
  },
  clearHordeDamageResult() {
    const { horde } = get();
    if (!horde || !horde.lastDamageResult) return;
    set({ horde: { ...horde, lastDamageResult: null } });
  },
  moveHordeCard(cardId, to) {
    const { state, horde, gameLog, hordePast, rewindTrail } = get();
    if (!state || !horde) return;
    const card =
      horde.board.battlefield.find((b) => b.card.id === cardId)?.card ??
      [
        ...horde.board.zones.library,
        ...horde.board.zones.graveyard,
        ...horde.board.zones.exile,
      ].find((c) => c.id === cardId);
    const board = applyAction(horde.board, {
      type: 'MOVE_TO_ZONE',
      cardId,
      to,
      toIndex: to === 'library' ? 0 : undefined,
    });
    if (board === horde.board) return; // no-op: not found, or already there
    const outcome = hordeOutcome(board, state.life);
    const attackingIds = horde.attackingIds.filter((id) => id !== cardId);
    const pendingAttack =
      horde.phase === 'combat' ? attackSummary(board.battlefield) : horde.pendingAttack;
    const nextHorde: SoloHordeState = {
      ...horde,
      board,
      attackingIds,
      pendingAttack,
      outcome,
      phase: outcome ? 'ended' : horde.phase,
    };
    const verb =
      to === 'graveyard'
        ? 'destroyed'
        : to === 'exile'
          ? 'exiled'
          : "returned to the horde's library";
    const text = card ? `${card.name} ${verb}` : `A horde card ${verb}`;
    const withPush = pushHordeEntry(state);
    const lines = [
      { turn: state.turn, kind: 'horde' as const, text },
      ...(outcome
        ? [{ turn: state.turn, kind: 'horde' as const, text: hordeOutcomeText(outcome) }]
        : []),
    ];
    set(
      hordeStepUpdate(
        withPush,
        state.past,
        horde,
        hordePast,
        nextHorde,
        gameLog,
        lines,
        rewindTrail
      )
    );
  },
  init(deckId, init, externalDeck) {
    // A live, meaningfully-played game being replaced by a fresh one (e.g.
    // navigating straight to a different deck's playtest) is itself a session
    // boundary (E141) — capture it before it's overwritten, same as RESET.
    const prev = get();
    const captured = tryRecordSession(
      prev.deckId,
      prev.state,
      prev.gameLog,
      prev.mulliganCount,
      prev.resistanceLevel !== 'off',
      prev.externalDeck ?? undefined,
      prev.horde
    );
    hordeSessionGen++;
    set({
      deckId,
      externalDeck: externalDeck ?? null,
      state: createPlaytestState(init),
      phase: 'opening',
      mulliganCount: 0,
      onDraw: false,
      resistanceLevel: 'off',
      resistanceState: null,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
      gameLog: [],
      rewindTrail: [],
      lastSessionRecord: captured?.record ?? null,
      horde: null,
      hordePast: [],
      hordeLoad: { status: 'idle', error: null, pending: null },
    });
  },
  hydrate(deckId, snapshot, externalDeck) {
    // Older snapshots (pre-E138) have no life field — backfill a
    // format-aware default rather than crash the reducer on undefined life.
    // A shared/public deck isn't in the decks store, so it arrives explicitly;
    // without it the migration would fall back to non-commander defaults and
    // resume a 40-life Commander game at 20.
    const deck = externalDeck ?? useDecksStore.getState().decks.find((d) => d.id === deckId);
    const migrated = backfillManaCost(migrateSnapshotState(snapshot.state, deck), deck);
    hordeSessionGen++;
    set({
      deckId,
      externalDeck: externalDeck ?? null,
      // `commanderTax` postdates the original snapshot shape (E139) — backfill
      // so a pre-existing localStorage session from before that change doesn't
      // crash the reducer the first time a commander leaves the command zone.
      // Designations postdate it too — same treatment. `migrated` already
      // backfills the E138 life field.
      state: {
        ...migrated,
        commanderTax: migrated.commanderTax ?? {},
        monarch: migrated.monarch ?? false,
        initiative: migrated.initiative ?? false,
        citysBlessing: migrated.citysBlessing ?? false,
        past: [],
      },
      phase: snapshot.phase,
      mulliganCount: snapshot.mulliganCount,
      onDraw: false,
      resistanceLevel: snapshot.resistanceLevel,
      resistanceState: snapshot.resistanceState,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
      lastSessionRecord: null,
      gameLog: snapshot.gameLog ?? [],
      // The undo stack itself is wiped on resume (`past: []` above) — nothing
      // survives to rewind past, so the trail starts fresh too.
      rewindTrail: [],
      // The horde itself resumes; its own alignment with `state.past` does
      // not — there is no `past` left to align it against (see above).
      horde: snapshot.horde ?? null,
      hordePast: [],
      hordeLoad: { status: 'idle', error: null, pending: null },
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
      const { resistanceLevel, gameLog, deckId, mulliganCount, horde } = get();
      // A meaningfully-played game ending in Reset is E141's session boundary.
      const captured = tryRecordSession(
        deckId,
        current,
        gameLog,
        mulliganCount,
        resistanceLevel !== 'off',
        get().externalDeck ?? undefined,
        horde
      );
      set({
        state: next,
        phase: 'opening',
        mulliganCount: 0,
        onDraw: false,
        resistanceState: resistanceLevel !== 'off' ? createResistanceState(next.rngSeed) : null,
        resistancePast: [],
        lastResistanceEvent: null,
        ...(captured && {
          lastSessionRecord: captured.record,
        }),
        gameLog: appendLogEntries(gameLog, [
          { turn: next.turn, kind: 'reset', text: 'Game reset' },
        ]),
        // RESET clears the reducer's own undo stack outright (reducer.ts) —
        // nothing survives to rewind past, so the trail resets alongside it.
        // See rewind.ts's own RESET case: this IS the hard wall, enforced by
        // construction (an empty trail reads as 'none', not a bypassable
        // 'locked') rather than needing a marker entry.
        rewindTrail: [],
        // A fresh game re-arms the same horde from scratch (below) rather
        // than carrying the old one's board/outcome into it.
        horde: null,
        hordePast: [],
      });
      // A fresh session — any arm still in flight from before this Reset
      // (armed but not yet landed) must not apply to it.
      hordeSessionGen++;
      // Re-arm the same fight fresh: the config Reset just wiped is exactly
      // what the new opening hand should face. Fire-and-forget — arming is
      // legal from the opening hand, and `armHorde` guards its own staleness.
      if (horde)
        void get().armHorde(horde.config.hordeId, horde.config.level, horde.config.overrides);
      return;
    }
    if (action.type === 'UNDO') {
      // Undo doesn't rewind the log — it's a journal of what happened,
      // undos included — it only appends a marker (when something was
      // actually popped; an empty `past` makes `next` === `current`).
      const {
        resistanceLevel,
        resistanceState,
        resistancePast,
        gameLog,
        rewindTrail,
        horde,
        hordePast,
      } = get();
      const undid = next !== current;
      const nextLog = undid
        ? appendLogEntries(gameLog, [{ turn: next.turn, kind: 'undo', text: 'Undid last action' }])
        : gameLog;
      const nextTrail = undid ? rewindTrail.slice(1) : rewindTrail;
      // Restore the horde alongside the board, same as Resistance below —
      // the popped entry's paired `hordePast` value is what was armed (or
      // not) when that entry was made.
      const nextHorde = undid ? (hordePast[0] ?? null) : horde;
      const nextHordePast = undid ? hordePast.slice(1) : hordePast;
      if (resistanceLevel !== 'off' && resistanceState) {
        // Rewind the opponent alongside the board: the popped entry's paired
        // snapshot (seed included) means replaying re-rolls the same response.
        set({
          state: next,
          resistanceState: resistancePast[0] ?? resistanceState,
          resistancePast: resistancePast.slice(1),
          gameLog: nextLog,
          rewindTrail: nextTrail,
          horde: nextHorde,
          hordePast: nextHordePast,
        });
      } else {
        set({
          state: next,
          gameLog: nextLog,
          rewindTrail: nextTrail,
          horde: nextHorde,
          hordePast: nextHordePast,
        });
      }
      return;
    }
    const entries = buildLogEntries(current, action, next);
    const {
      resistanceLevel,
      resistanceState,
      resistancePast,
      gameLog,
      rewindTrail,
      horde,
      hordePast,
    } = get();
    // A horde is live for the whole dispatch, not just the horde's own
    // methods: an ordinary life change (a board wipe, a bad attack) can be
    // the thing that ends the fight. Recomputed unconditionally — cheap, and
    // idempotent when life didn't move.
    const nextHordePast = (finalPast: readonly Omit<PlaytestState, 'past'>[]) =>
      [
        ...Array<SoloHordeState | null>(pushedEntries(current.past, finalPast)).fill(horde),
        ...hordePast,
      ].slice(0, finalPast.length);
    const checkHordeOutcome = (life: number): SoloHordeState | null => {
      if (!horde || horde.phase === 'ended') return horde;
      const outcome = hordeOutcome(horde.board, life);
      return outcome ? { ...horde, phase: 'ended', outcome } : horde;
    };
    const config = configFor(resistanceLevel);
    if (config && resistanceState) {
      const result = applyResistance(resistanceState, current, next, action, config);
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
      const newLog = appendLogEntries(gameLog, allEntries);
      // Every push this dispatch made needs its own classification: the
      // player's own action, plus one per Resistance response target (each
      // is a MOVE_TO_ZONE off the battlefield — same shape regardless of
      // which card, so classifying a placeholder cardId is exactly the real
      // classification without needing the per-target intermediate states
      // `applyResistance` doesn't expose). Newest-first, matching `pairs`.
      const primary = trailEntry(classifyAction(current, action), entries[0]?.text ?? null);
      const responseTrail =
        pushed > 1
          ? Array<RewindTrailEntry>(pushed - 1).fill(
              trailEntry(
                classifyAction(current, {
                  type: 'MOVE_TO_ZONE',
                  cardId: '__resistance-response__',
                  to: 'graveyard',
                }),
                result.message
              )
            )
          : [];
      const newTrail = pushed > 0 ? [...responseTrail, primary] : [];
      set({
        state: result.state,
        resistanceState: result.resistanceState,
        resistancePast: [...pairs, ...resistancePast].slice(0, result.state.past.length),
        gameLog: newLog,
        rewindTrail: [...newTrail, ...rewindTrail].slice(0, result.state.past.length),
        ...(result.message !== null && {
          lastResistanceEvent: { id: seq, message: result.message },
          resistanceEventSeq: seq,
        }),
        horde: checkHordeOutcome(result.state.life),
        hordePast: nextHordePast(result.state.past),
      });
      return;
    }
    const newLog = appendLogEntries(gameLog, entries);
    const newTrail =
      next !== current
        ? [trailEntry(classifyAction(current, action), entries[0]?.text ?? null)]
        : [];
    set({
      state: next,
      gameLog: newLog,
      rewindTrail: [...newTrail, ...rewindTrail].slice(0, next.past.length),
      horde: checkHordeOutcome(next.life),
      hordePast: nextHordePast(next.past),
    });
  },
  applyPrintedBodies(bodies) {
    const current = get().state;
    if (!current || bodies.size === 0) return;
    let changed = false;
    const patchCard = (card: PlaytestCard): PlaytestCard => {
      // A card that already prints a body is right, and a hand-made token's
      // body is whatever its maker typed — neither is ours to overwrite.
      if (card.power !== undefined || card.isToken) return card;
      const body = bodies.get(card.name);
      if (!body) return card;
      changed = true;
      return { ...card, power: body.power, toughness: body.toughness };
    };
    // Generic over the state shape because history entries are stored as
    // `Omit<PlaytestState, 'past'>` — the same patch, one implementation.
    // Every zone the state has, not a hand-kept list: the generic spread lets
    // a short list type-check, and a list that missed `sideboard` wiped it and
    // crashed the board on every load.
    const patchState = <T extends Omit<PlaytestState, 'past'>>(s: T): T => ({
      ...s,
      zones: Object.fromEntries(
        Object.entries(s.zones).map(([zone, cards]) => [zone, cards.map(patchCard)])
      ) as T['zones'],
      battlefield: s.battlefield.map((bf) => {
        const card = patchCard(bf.card);
        return card === bf.card ? bf : { ...bf, card };
      }),
    });
    // History too, or an undo would take the badges back off a permanent that
    // has been on the board the whole time.
    const next = { ...patchState(current), past: current.past.map(patchState) };
    if (!changed) return;
    set({ state: next });
  },
  setResistanceLevel(level) {
    // Mutually exclusive with a horde — disarm it first, as its own
    // undoable entry, before arming (or clearing) Resistance.
    if (level !== 'off') {
      const disarm = disarmHordePatch(get());
      if (disarm) set(disarm);
    }
    const { state, gameLog } = get();
    saveLastResistanceLevel(level);
    const nextLog = appendLogEntries(gameLog, [
      { turn: state?.turn ?? 1, kind: 'resistance', text: RESISTANCE_LEVEL_ANNOUNCE[level] },
    ]);
    if (level === 'off') {
      set({
        resistanceLevel: 'off',
        resistanceState: null,
        resistancePast: [],
        lastResistanceEvent: null,
        gameLog: nextLog,
      });
      return;
    }
    // Any pick (including switching between two armed levels) arms a fresh
    // opponent — simplest correct model, and matches the pre-E142 on/off
    // toggle's behavior of always starting clean when (re-)armed.
    // Seed from the game's rngSeed when available so a seeded session gets a
    // deterministic opponent; Date.now() is a fine fallback (app code).
    const fresh = createResistanceState(state?.rngSeed ?? Date.now());
    set({
      resistanceLevel: level,
      resistanceState: fresh,
      // Pre-pick history entries pair with the fresh opponent: undoing into
      // them keeps `state.past`/`resistancePast` aligned.
      resistancePast: Array<ResistanceState>(state?.past.length ?? 0).fill(fresh),
      gameLog: nextLog,
    });
  },
  setFreeMulligan(on) {
    saveFreeMulligan(on);
    // Flipping it on while already sitting in the bottom-N step means the
    // player just decided those cards shouldn't be owed — drop straight into
    // play rather than stranding them on a step the variant doesn't have.
    const { phase, tableMulliganType } = get();
    // Seated at a table, the table's rule decides — flipping the device
    // preference must not skip a bottom-N step the pod agreed on.
    const skips = on && tableMulliganType === null;
    set({ freeMulligan: on, ...(skips && phase === 'mulligan-bottom' && { phase: 'playing' }) });
  },
  setTableMulliganType(type) {
    set({ tableMulliganType: type });
  },
  setTakebackMode(mode) {
    saveTakebackMode(mode);
    set({ takebackMode: mode });
  },
  setOnDraw(on) {
    set({ onDraw: on });
  },
  keepOpeningHand() {
    const { mulliganCount, freeMulligan, tableMulliganType, onDraw } = get();
    if (cardsToBottom(effectiveMulliganType(freeMulligan, tableMulliganType), mulliganCount) > 0) {
      set({ phase: 'mulligan-bottom' });
      return;
    }
    // Play actually starts here (no bottom-N step owed) — on the draw means
    // one extra card the instant it does, via the normal DRAW action so it's
    // logged/undoable like anything else.
    if (onDraw) get().dispatch({ type: 'DRAW', n: 1 });
    set({ phase: 'playing' });
  },
  mulliganOpeningHand() {
    const current = get().state;
    if (!current) return;
    const next = applyAction(current, { type: 'MULLIGAN' });
    const mulliganEntries = buildLogEntries(current, { type: 'MULLIGAN' }, next);
    const { resistanceState, resistancePast, gameLog, rewindTrail, horde, hordePast } = get();
    set({
      state: next,
      mulliganCount: get().mulliganCount + 1,
      gameLog: appendLogEntries(gameLog, mulliganEntries),
      rewindTrail: [
        trailEntry(classifyAction(current, { type: 'MULLIGAN' }), mulliganEntries[0]?.text ?? null),
        ...rewindTrail,
      ].slice(0, next.past.length),
      // Keep resistancePast aligned if Resistance was toggled on pre-play.
      ...(resistanceState && {
        resistancePast: [
          ...Array<ResistanceState>(pushedEntries(current.past, next.past)).fill(resistanceState),
          ...resistancePast,
        ].slice(0, next.past.length),
      }),
      hordePast: [
        ...Array<SoloHordeState | null>(pushedEntries(current.past, next.past)).fill(horde),
        ...hordePast,
      ].slice(0, next.past.length),
    });
  },
  finalizeBottom(cardIds) {
    let current = get().state;
    if (!current) return;
    const before = current;
    // Newest-first as we go, matching rewindTrail's own convention — each
    // card bottomed later is pushed onto `past` after the one before it.
    const trailAdds: RewindTrailEntry[] = [];
    // One journal line per bottomed card. Built here rather than via
    // `buildLogEntries` because the generic zone-move line ("hand → library")
    // hides the one thing that matters about this step: the card went to
    // the BOTTOM. `toPublicTicker` drops hand→library moves, so these never
    // reach opponents.
    const bottomed: Omit<GameLogEntry, 'seq'>[] = [];
    // Each card moves to the bottom of the library (toIndex = library length).
    // Recompute the index between actions so successive sends append correctly.
    for (const cardId of cardIds) {
      const name = current.zones.hand.find((c) => c.id === cardId)?.name;
      const move = {
        type: 'MOVE_TO_ZONE',
        cardId,
        to: 'library',
        toIndex: current.zones.library.length,
      } as const;
      const line = name ? `${name}: hand → bottom of library` : null;
      if (name && line) {
        bottomed.push({
          turn: current.turn,
          kind: 'zone-move',
          text: line,
          cardName: name,
          from: 'hand',
          to: 'library',
        });
      }
      trailAdds.unshift(trailEntry(classifyAction(current, move), line));
      current = applyAction(current, move);
    }
    const { resistanceState, resistancePast, onDraw, rewindTrail, gameLog, horde, hordePast } =
      get();
    set({
      state: current,
      phase: 'playing',
      gameLog: appendLogEntries(gameLog, bottomed),
      rewindTrail: [...trailAdds, ...rewindTrail].slice(0, current.past.length),
      ...(resistanceState && {
        resistancePast: [
          ...Array<ResistanceState>(pushedEntries(before.past, current.past)).fill(resistanceState),
          ...resistancePast,
        ].slice(0, current.past.length),
      }),
      hordePast: [
        ...Array<SoloHordeState | null>(pushedEntries(before.past, current.past)).fill(horde),
        ...hordePast,
      ].slice(0, current.past.length),
    });
    // Play starts here too (post-mulligan path) — same on-the-draw extra card
    // as the no-mulligan path in keepOpeningHand, applied after phase flips
    // so it dispatches against the just-committed bottomed state.
    if (onDraw) get().dispatch({ type: 'DRAW', n: 1 });
  },
  teardown() {
    // Navigating away mid-game (no Reset) is the most common real way a
    // casual session actually ends — capture it here too (E141) so it isn't
    // lost. Side-effect only: the summary UI is unmounting anyway.
    const prev = get();
    tryRecordSession(
      prev.deckId,
      prev.state,
      prev.gameLog,
      prev.mulliganCount,
      prev.resistanceLevel !== 'off',
      prev.externalDeck ?? undefined,
      prev.horde
    );
    hordeSessionGen++;
    set({
      state: null,
      deckId: null,
      externalDeck: null,
      phase: 'opening',
      mulliganCount: 0,
      resistanceLevel: 'off',
      resistanceState: null,
      resistancePast: [],
      lastResistanceEvent: null,
      resistanceEventSeq: 0,
      gameLog: [],
      rewindTrail: [],
      lastSessionRecord: null,
      horde: null,
      hordePast: [],
      hordeLoad: { status: 'idle', error: null, pending: null },
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
  const { state, deckId, phase, mulliganCount, resistanceLevel, resistanceState, gameLog, horde } =
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
      resistanceLevel,
      resistanceState,
      gameLog,
      state: rest,
      horde,
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
  // Mobile Safari can suspend the tab before the debounce fires —
  // flush on both signals so backgrounding never loses the last few plays.
  window.addEventListener('pagehide', flushPendingPlaytestSnapshot);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPlaytestSnapshot();
  });
}
