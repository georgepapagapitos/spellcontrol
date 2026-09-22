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
  deckOverride?: Deck
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
      prev.externalDeck ?? undefined
    );
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
      const { resistanceLevel, gameLog, deckId, mulliganCount } = get();
      // A meaningfully-played game ending in Reset is E141's session boundary.
      const captured = tryRecordSession(
        deckId,
        current,
        gameLog,
        mulliganCount,
        resistanceLevel !== 'off',
        get().externalDeck ?? undefined
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
      });
      return;
    }
    if (action.type === 'UNDO') {
      // Undo doesn't rewind the log — it's a journal of what happened,
      // undos included — it only appends a marker (when something was
      // actually popped; an empty `past` makes `next` === `current`).
      const { resistanceLevel, resistanceState, resistancePast, gameLog, rewindTrail } = get();
      const undid = next !== current;
      const nextLog = undid
        ? appendLogEntries(gameLog, [{ turn: next.turn, kind: 'undo', text: 'Undid last action' }])
        : gameLog;
      const nextTrail = undid ? rewindTrail.slice(1) : rewindTrail;
      if (resistanceLevel !== 'off' && resistanceState) {
        // Rewind the opponent alongside the board: the popped entry's paired
        // snapshot (seed included) means replaying re-rolls the same response.
        set({
          state: next,
          resistanceState: resistancePast[0] ?? resistanceState,
          resistancePast: resistancePast.slice(1),
          gameLog: nextLog,
          rewindTrail: nextTrail,
        });
      } else {
        set({ state: next, gameLog: nextLog, rewindTrail: nextTrail });
      }
      return;
    }
    const entries = buildLogEntries(current, action, next);
    const { resistanceLevel, resistanceState, resistancePast, gameLog, rewindTrail } = get();
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
    const patchState = <T extends Omit<PlaytestState, 'past'>>(s: T): T => ({
      ...s,
      zones: {
        library: s.zones.library.map(patchCard),
        hand: s.zones.hand.map(patchCard),
        graveyard: s.zones.graveyard.map(patchCard),
        exile: s.zones.exile.map(patchCard),
        command: s.zones.command.map(patchCard),
      },
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
    const { resistanceState, resistancePast, gameLog, rewindTrail } = get();
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
    const { resistanceState, resistancePast, onDraw, rewindTrail, gameLog } = get();
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
      prev.externalDeck ?? undefined
    );
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
  const { state, deckId, phase, mulliganCount, resistanceLevel, resistanceState, gameLog } =
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
