import { describe, expect, it } from 'vitest';
import {
  MIN_SESSIONS_FOR_STATS,
  buildLandNameSet,
  computeSessionAggregates,
  countLandDrops,
  countResistanceEvents,
  deriveSessionRecord,
  formatSessionSummaryLine,
  formatVsAverageLine,
  isMeaningfulSession,
  sessionHeadline,
  sessionLogSegment,
  type PlaytestSessionRecord,
} from './session-record';
import type { GameLogEntry } from './game-log';
import type { PlaytestState } from './types';

function baseState(
  overrides: Partial<Omit<PlaytestState, 'past'>> = {}
): Omit<PlaytestState, 'past'> {
  return {
    zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
    battlefield: [],
    rngSeed: 1,
    turn: 1,
    commanderTax: {},
    life: 20,
    opponents: [{ life: 20, commanderDamage: 0 }],
    startingLife: 20,
    startingOpponentLife: 20,
    commanderDamageThreshold: 21,
    tableDefeatedTurn: null,
    ...overrides,
  };
}

let seq = 0;
function entry(overrides: Partial<GameLogEntry>): GameLogEntry {
  seq += 1;
  return { seq, turn: 1, kind: 'draw', text: 'Drew 1 card', ...overrides };
}

// ── isMeaningfulSession ──────────────────────────────────────────────────────

describe('isMeaningfulSession', () => {
  it('is false at turn 1 with an empty board', () => {
    expect(isMeaningfulSession(baseState())).toBe(false);
  });

  it('is true once a turn has passed', () => {
    expect(isMeaningfulSession(baseState({ turn: 2 }))).toBe(true);
  });

  it('is true once something is on the battlefield, even at turn 1', () => {
    const state = baseState({ battlefield: [{ card: { id: 'c1', name: 'X' } } as never] });
    expect(isMeaningfulSession(state)).toBe(true);
  });
});

// ── sessionLogSegment ────────────────────────────────────────────────────────

describe('sessionLogSegment', () => {
  it('returns the whole log when there is no reset', () => {
    const log = [entry({ turn: 1 }), entry({ turn: 2 })];
    expect(sessionLogSegment(log)).toEqual(log);
  });

  it('slices to only the entries after the last reset marker', () => {
    const log = [
      entry({ turn: 1, text: 'before' }),
      entry({ turn: 1, kind: 'reset', text: 'Game reset' }),
      entry({ turn: 1, text: 'after' }),
    ];
    const segment = sessionLogSegment(log);
    expect(segment).toHaveLength(1);
    expect(segment[0].text).toBe('after');
  });

  it('handles multiple resets by anchoring on the last one', () => {
    const log = [
      entry({ kind: 'reset', text: 'reset 1' }),
      entry({ text: 'stale' }),
      entry({ kind: 'reset', text: 'reset 2' }),
      entry({ text: 'fresh' }),
    ];
    const segment = sessionLogSegment(log);
    expect(segment.map((e) => e.text)).toEqual(['fresh']);
  });

  it('returns empty when the log ends with a reset', () => {
    expect(sessionLogSegment([entry({ kind: 'reset' })])).toEqual([]);
  });
});

// ── buildLandNameSet ─────────────────────────────────────────────────────────

describe('buildLandNameSet', () => {
  it('returns an empty set when the deck is undefined', () => {
    expect(buildLandNameSet(undefined).size).toBe(0);
  });

  it('collects land names from mainboard cards and both commanders', () => {
    const deck = {
      cards: [
        { card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
        { card: { name: 'Lightning Bolt', type_line: 'Instant' } },
      ],
      commander: { name: 'Command Tower', type_line: 'Land' },
      partnerCommander: { name: 'Sol Ring', type_line: 'Artifact' },
    } as never;
    const names = buildLandNameSet(deck);
    expect(names.has('Forest')).toBe(true);
    expect(names.has('Command Tower')).toBe(true);
    expect(names.has('Lightning Bolt')).toBe(false);
    expect(names.has('Sol Ring')).toBe(false);
  });
});

// ── countLandDrops ───────────────────────────────────────────────────────────

describe('countLandDrops', () => {
  const isLand = (name: string) => name === 'Forest';

  it('counts a hit for every turn with a land play, a miss otherwise', () => {
    const log = [
      entry({ turn: 1, kind: 'play', cardName: 'Forest' }),
      entry({ turn: 2, kind: 'play', cardName: 'Lightning Bolt' }),
      entry({ turn: 3, kind: 'play', cardName: 'Forest' }),
    ];
    expect(countLandDrops(log, 3, isLand)).toEqual({ hit: 2, missed: 1, turnsChecked: 3 });
  });

  it('caps the checked window at maxTurn', () => {
    const log = [entry({ turn: 1, kind: 'play', cardName: 'Forest' })];
    const result = countLandDrops(log, 20, isLand, 5);
    expect(result.turnsChecked).toBe(5);
    expect(result.hit).toBe(1);
    expect(result.missed).toBe(4);
  });

  it('returns zeroes when finalTurn is 0 or negative', () => {
    expect(countLandDrops([], 0, isLand)).toEqual({ hit: 0, missed: 0, turnsChecked: 0 });
  });

  it('ignores non-play entries and plays without a land name', () => {
    const log = [
      entry({ turn: 1, kind: 'draw', cardName: 'Forest' }),
      entry({ turn: 1, kind: 'play' }), // no cardName
    ];
    expect(countLandDrops(log, 1, isLand)).toEqual({ hit: 0, missed: 1, turnsChecked: 1 });
  });

  it('multiple land plays on one turn still count as a single hit', () => {
    const log = [
      entry({ turn: 1, kind: 'play', cardName: 'Forest' }),
      entry({ turn: 1, kind: 'play', cardName: 'Forest' }),
    ];
    expect(countLandDrops(log, 1, isLand)).toEqual({ hit: 1, missed: 0, turnsChecked: 1 });
  });
});

// ── countResistanceEvents ────────────────────────────────────────────────────

describe('countResistanceEvents', () => {
  it('classifies counter/destroy/bounce/wipe from the message text', () => {
    const log = [
      entry({ kind: 'resistance', text: 'Opponent casts Counterspell — Threat is countered' }),
      entry({ kind: 'resistance', text: 'Opponent casts Doom Blade — Threat is destroyed' }),
      entry({ kind: 'resistance', text: 'Opponent casts Boomerang — Threat is returned to hand' }),
      entry({ kind: 'resistance', text: 'Opponent casts Wrath of God — the board is wiped' }),
      entry({ kind: 'resistance', text: 'Opponent casts Doom Blade — Threat is destroyed' }),
    ];
    expect(countResistanceEvents(log)).toEqual({
      counters: 1,
      removals: 2,
      bounces: 1,
      wipesSurvived: 1,
    });
  });

  it('ignores non-resistance entries', () => {
    const log = [entry({ kind: 'draw', text: 'Drew 1 card' })];
    expect(countResistanceEvents(log)).toEqual({
      counters: 0,
      removals: 0,
      bounces: 0,
      wipesSurvived: 0,
    });
  });
});

// ── deriveSessionRecord ──────────────────────────────────────────────────────

describe('deriveSessionRecord', () => {
  it('derives a kill session', () => {
    const state = baseState({
      turn: 8,
      tableDefeatedTurn: 8,
      opponents: [{ life: 0, commanderDamage: 0 }],
      battlefield: [{ card: { id: 'c1', name: 'X', isToken: false } } as never],
    });
    const record = deriveSessionRecord({
      deckId: 'deck-1',
      log: [],
      state,
      mulliganCount: 1,
      resistance: false,
      deckSize: null,
      isLandName: () => false,
    });
    expect(record.deckId).toBe('deck-1');
    expect(record.turns).toBe(8);
    expect(record.killTurn).toBe(8);
    expect(record.opponentsDefeated).toBe(1);
    expect(record.mulligans).toBe(1);
    expect(record.cardsDrawn).toBeNull();
    expect(record.id).toContain('deck-1');
  });

  it('derives a no-kill session (killTurn stays null)', () => {
    const state = baseState({ turn: 5, tableDefeatedTurn: null });
    const record = deriveSessionRecord({
      deckId: 'deck-2',
      log: [],
      state,
      mulliganCount: 0,
      resistance: false,
      deckSize: null,
      isLandName: () => false,
    });
    expect(record.killTurn).toBeNull();
    expect(record.opponentsDefeated).toBe(0);
  });

  it('only counts resistance/land-drop evidence from the segment since the last reset', () => {
    const state = baseState({ turn: 2 });
    const log: GameLogEntry[] = [
      entry({ turn: 1, kind: 'play', cardName: 'Forest' }), // stale, before reset
      entry({ turn: 1, kind: 'reset', text: 'Game reset' }),
      entry({ turn: 1, kind: 'play', cardName: 'Lightning Bolt' }),
    ];
    const record = deriveSessionRecord({
      deckId: 'deck-3',
      log,
      state,
      mulliganCount: 0,
      resistance: false,
      deckSize: null,
      isLandName: (name) => name === 'Forest',
    });
    // Only turn 1-2 of the post-reset segment are checked; the pre-reset
    // Forest play must not count toward this session's land drops.
    expect(record.landDropsHit).toBe(0);
    expect(record.landDropsMissed).toBe(2);
  });

  it('computes cardsDrawn from deckSize when known', () => {
    const state = baseState({
      zones: {
        library: [{ id: 'l1', name: 'L' }],
        hand: [{ id: 'h1', name: 'H' }],
        graveyard: [],
        exile: [],
        command: [],
      },
      battlefield: [{ card: { id: 'b1', name: 'B', isToken: false } } as never],
    });
    const record = deriveSessionRecord({
      deckId: 'deck-4',
      log: [],
      state,
      mulliganCount: 0,
      resistance: false,
      deckSize: 10,
      isLandName: () => false,
    });
    // 10 total - 1 library - 1 hand - 0 gy - 0 exile - 1 battlefield = 7
    expect(record.cardsDrawn).toBe(7);
  });

  it('carries resistance event tallies through from the log', () => {
    const state = baseState({ turn: 3 });
    const log: GameLogEntry[] = [
      entry({
        turn: 2,
        kind: 'resistance',
        text: 'Opponent casts Wrath of God — the board is wiped',
      }),
    ];
    const record = deriveSessionRecord({
      deckId: 'deck-5',
      log,
      state,
      mulliganCount: 0,
      resistance: true,
      deckSize: null,
      isLandName: () => false,
    });
    expect(record.resistance).toBe(true);
    expect(record.resistanceWipesSurvived).toBe(1);
  });
});

// ── computeSessionAggregates ─────────────────────────────────────────────────

function makeRecord(overrides: Partial<PlaytestSessionRecord> = {}): PlaytestSessionRecord {
  return {
    id: 'r',
    deckId: 'deck-1',
    endedAt: 0,
    turns: 5,
    mulligans: 0,
    killTurn: null,
    opponentCount: 1,
    opponentsDefeated: 0,
    resistance: false,
    resistanceCounters: 0,
    resistanceRemovals: 0,
    resistanceBounces: 0,
    resistanceWipesSurvived: 0,
    landDropsHit: 0,
    landDropsMissed: 0,
    landDropTurnsChecked: 0,
    cardsDrawn: null,
    ...overrides,
  };
}

describe('computeSessionAggregates', () => {
  it('returns zeroed/null aggregates for an empty history', () => {
    const agg = computeSessionAggregates([]);
    expect(agg.sessionsPlayed).toBe(0);
    expect(agg.medianKillTurn).toBeNull();
    expect(agg.bestKillTurn).toBeNull();
    expect(agg.killRate).toBe(0);
    expect(agg.landDropMissRate).toBeNull();
    expect(agg.wipeSurvivalRate).toBeNull();
    expect(agg.killTurnHistogram).toEqual([]);
  });

  it('computes median kill turn (odd and even counts)', () => {
    const odd = computeSessionAggregates([
      makeRecord({ killTurn: 6 }),
      makeRecord({ killTurn: 8 }),
      makeRecord({ killTurn: 10 }),
    ]);
    expect(odd.medianKillTurn).toBe(8);

    const even = computeSessionAggregates([
      makeRecord({ killTurn: 6 }),
      makeRecord({ killTurn: 8 }),
      makeRecord({ killTurn: 10 }),
      makeRecord({ killTurn: 12 }),
    ]);
    expect(even.medianKillTurn).toBe(9);
  });

  it('computes best (minimum) kill turn', () => {
    const agg = computeSessionAggregates([
      makeRecord({ killTurn: 10 }),
      makeRecord({ killTurn: 6 }),
      makeRecord({ killTurn: null }),
    ]);
    expect(agg.bestKillTurn).toBe(6);
  });

  it('computes kill rate as wins / total sessions', () => {
    const agg = computeSessionAggregates([
      makeRecord({ killTurn: 6 }),
      makeRecord({ killTurn: null }),
      makeRecord({ killTurn: null }),
      makeRecord({ killTurn: null }),
    ]);
    expect(agg.killRate).toBe(0.25);
  });

  it('pools land-drop miss rate only across sessions with a checkable window', () => {
    const agg = computeSessionAggregates([
      makeRecord({ landDropTurnsChecked: 10, landDropsMissed: 2, landDropsHit: 8 }),
      makeRecord({ landDropTurnsChecked: 10, landDropsMissed: 4, landDropsHit: 6 }),
      makeRecord({ landDropTurnsChecked: 0, landDropsMissed: 0, landDropsHit: 0 }),
    ]);
    expect(agg.landDropMissRate).toBeCloseTo(6 / 20);
  });

  it('computes wipe survival rate only across Resistance-on sessions', () => {
    const agg = computeSessionAggregates([
      makeRecord({ resistance: true, resistanceWipesSurvived: 1 }),
      makeRecord({ resistance: true, resistanceWipesSurvived: 0 }),
      makeRecord({ resistance: false }),
    ]);
    expect(agg.wipeSurvivalRate).toBe(0.5);
  });

  it('returns null wipe survival rate when no session had Resistance on', () => {
    const agg = computeSessionAggregates([makeRecord({ resistance: false })]);
    expect(agg.wipeSurvivalRate).toBeNull();
  });

  it('builds a sorted, zero-omitted kill-turn histogram', () => {
    const agg = computeSessionAggregates([
      makeRecord({ killTurn: 8 }),
      makeRecord({ killTurn: 6 }),
      makeRecord({ killTurn: 8 }),
      makeRecord({ killTurn: null }),
    ]);
    expect(agg.killTurnHistogram).toEqual([
      { turn: 6, count: 1 },
      { turn: 8, count: 2 },
    ]);
  });
});

// ── formatting helpers ───────────────────────────────────────────────────────

describe('sessionHeadline', () => {
  it('names the kill turn when there is one', () => {
    expect(sessionHeadline(makeRecord({ killTurn: 8, turns: 8 }))).toBe('Turn 8 kill');
  });

  it('falls back to a neutral headline with no kill', () => {
    expect(sessionHeadline(makeRecord({ killTurn: null, turns: 5 }))).toBe('Turn 5 — game ended');
  });
});

describe('formatSessionSummaryLine', () => {
  it('joins the applicable parts with a mid-dot', () => {
    const record = makeRecord({
      mulligans: 1,
      resistance: true,
      resistanceCounters: 1,
      resistanceRemovals: 1,
      resistanceWipesSurvived: 1,
      landDropTurnsChecked: 5,
      landDropsMissed: 0,
    });
    expect(formatSessionSummaryLine(record)).toBe(
      '1 mulligan · survived 2 removals + 1 wipe · 0 missed land drops'
    );
  });

  it('omits resistance parts when nothing was survived', () => {
    const record = makeRecord({ resistance: true, landDropTurnsChecked: 3, landDropsMissed: 1 });
    expect(formatSessionSummaryLine(record)).toBe('1 missed land drop');
  });

  it('falls back to a turns-played line when nothing else applies', () => {
    expect(formatSessionSummaryLine(makeRecord({ turns: 3 }))).toBe('3 turns played');
  });

  it('singularizes a single missed land drop and single mulligan', () => {
    const record = makeRecord({ mulligans: 1, landDropTurnsChecked: 1, landDropsMissed: 1 });
    expect(formatSessionSummaryLine(record)).toBe('1 mulligan · 1 missed land drop');
  });
});

describe('formatVsAverageLine', () => {
  it('is null below MIN_SESSIONS_FOR_STATS', () => {
    const agg = computeSessionAggregates(
      Array.from({ length: MIN_SESSIONS_FOR_STATS - 1 }, () => makeRecord({ killTurn: 8 }))
    );
    expect(formatVsAverageLine(agg)).toBeNull();
  });

  it('is null when there is no kill data yet, even with enough sessions', () => {
    const agg = computeSessionAggregates(
      Array.from({ length: MIN_SESSIONS_FOR_STATS }, () => makeRecord({ killTurn: null }))
    );
    expect(formatVsAverageLine(agg)).toBeNull();
  });

  it('names the median kill turn once there are enough sessions', () => {
    const agg = computeSessionAggregates([
      makeRecord({ killTurn: 8 }),
      makeRecord({ killTurn: 9 }),
      makeRecord({ killTurn: 10 }),
    ]);
    expect(formatVsAverageLine(agg)).toBe('your median kill: turn 9');
  });
});
