// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlaytestSnapshot,
  fingerprintDeck,
  isResumeWorthy,
  loadPlaytestSnapshot,
  migrateSnapshotState,
  savePlaytestSnapshot,
  type PlaytestSnapshot,
} from './session-snapshot';
import type { PlaytestState } from './types';

function baseState(
  overrides: Partial<Omit<PlaytestState, 'past'>> = {}
): Omit<PlaytestState, 'past'> {
  return {
    zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
    battlefield: [],
    rngSeed: 42,
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

function baseSnapshot(overrides: Partial<PlaytestSnapshot> = {}): PlaytestSnapshot {
  return {
    fingerprint: '100:60',
    savedAt: Date.now(),
    phase: 'playing',
    mulliganCount: 0,
    resistance: false,
    resistanceState: null,
    state: baseState({ turn: 3 }),
    gameLog: [],
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe('fingerprintDeck', () => {
  it('combines updatedAt and card count', () => {
    expect(fingerprintDeck({ updatedAt: 123, cards: [{}, {}] as never })).toBe('123:2');
  });
});

describe('isResumeWorthy', () => {
  it('is false for a fresh opening hand, turn 1, empty board', () => {
    expect(isResumeWorthy({ phase: 'opening', state: baseState() })).toBe(false);
  });

  it('is true once past the opening phase', () => {
    expect(isResumeWorthy({ phase: 'mulligan-bottom', state: baseState() })).toBe(true);
  });

  it('is true once a turn has passed', () => {
    expect(isResumeWorthy({ phase: 'opening', state: baseState({ turn: 2 }) })).toBe(true);
  });

  it('is true once something is on the battlefield', () => {
    const state = baseState({ battlefield: [{ card: { id: 'c1', name: 'X' } } as never] });
    expect(isResumeWorthy({ phase: 'opening', state })).toBe(true);
  });
});

describe('save/load round-trip', () => {
  it('round-trips a saved snapshot when the fingerprint matches', () => {
    const snap = baseSnapshot();
    savePlaytestSnapshot('deck-1', snap);
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toEqual(snap);
  });

  it('excludes the undo stack shape (state has no past field)', () => {
    const snap = baseSnapshot();
    savePlaytestSnapshot('deck-1', snap);
    const loaded = loadPlaytestSnapshot('deck-1', '100:60');
    expect(loaded?.state).not.toHaveProperty('past');
  });

  it('returns null when there is nothing saved', () => {
    expect(loadPlaytestSnapshot('deck-none', '100:60')).toBeNull();
  });

  it('rejects and discards a snapshot whose fingerprint is stale', () => {
    savePlaytestSnapshot('deck-1', baseSnapshot({ fingerprint: '100:60' }));
    expect(loadPlaytestSnapshot('deck-1', '101:60')).toBeNull();
    // Stale snapshot is discarded, not just ignored — a later matching fingerprint still misses.
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  it('rejects and discards corrupt JSON without throwing', () => {
    localStorage.setItem('spellcontrol:playtest:deck-1', 'not-json{{{');
    expect(() => loadPlaytestSnapshot('deck-1', '100:60')).not.toThrow();
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  it('rejects a well-formed-JSON but malformed snapshot', () => {
    localStorage.setItem('spellcontrol:playtest:deck-1', JSON.stringify({ foo: 'bar' }));
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  it('clearPlaytestSnapshot removes a saved snapshot', () => {
    savePlaytestSnapshot('deck-1', baseSnapshot());
    clearPlaytestSnapshot('deck-1');
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  it('round-trips a populated gameLog', () => {
    const snap = baseSnapshot({
      gameLog: [{ seq: 1, turn: 1, kind: 'draw', text: 'Drew 1 card' }],
    });
    savePlaytestSnapshot('deck-1', snap);
    expect(loadPlaytestSnapshot('deck-1', '100:60')?.gameLog).toEqual(snap.gameLog);
  });

  it('loads a pre-E140 snapshot with no gameLog field as an empty log', () => {
    const { gameLog: _gameLog, ...withoutLog } = baseSnapshot();
    localStorage.setItem('spellcontrol:playtest:deck-1', JSON.stringify(withoutLog));
    const loaded = loadPlaytestSnapshot('deck-1', '100:60');
    expect(loaded).not.toBeNull();
    expect(loaded?.gameLog).toEqual([]);
  });
});

describe('pruning to the most recent decks', () => {
  it('keeps only the 3 most recently-saved decks', () => {
    savePlaytestSnapshot('deck-a', baseSnapshot({ fingerprint: 'a' }));
    savePlaytestSnapshot('deck-b', baseSnapshot({ fingerprint: 'b' }));
    savePlaytestSnapshot('deck-c', baseSnapshot({ fingerprint: 'c' }));
    savePlaytestSnapshot('deck-d', baseSnapshot({ fingerprint: 'd' }));

    expect(loadPlaytestSnapshot('deck-a', 'a')).toBeNull();
    expect(loadPlaytestSnapshot('deck-b', 'b')).not.toBeNull();
    expect(loadPlaytestSnapshot('deck-c', 'c')).not.toBeNull();
    expect(loadPlaytestSnapshot('deck-d', 'd')).not.toBeNull();
  });

  it('re-saving an existing deck refreshes its recency instead of duplicating it', () => {
    savePlaytestSnapshot('deck-a', baseSnapshot({ fingerprint: 'a' }));
    savePlaytestSnapshot('deck-b', baseSnapshot({ fingerprint: 'b' }));
    savePlaytestSnapshot('deck-c', baseSnapshot({ fingerprint: 'c' }));
    savePlaytestSnapshot('deck-a', baseSnapshot({ fingerprint: 'a2' }));
    savePlaytestSnapshot('deck-d', baseSnapshot({ fingerprint: 'd' }));

    // deck-a was refreshed most recently (after re-save), so it survives the prune.
    expect(loadPlaytestSnapshot('deck-a', 'a2')).not.toBeNull();
    expect(loadPlaytestSnapshot('deck-b', 'b')).toBeNull();
    expect(loadPlaytestSnapshot('deck-c', 'c')).not.toBeNull();
    expect(loadPlaytestSnapshot('deck-d', 'd')).not.toBeNull();
  });
});

describe('E138 life fields — backward compat with pre-E138 snapshots', () => {
  it('loads a pre-E138 snapshot (no life/opponents at all) without crashing', () => {
    // Simulates a real localStorage blob written before E138 shipped.
    const legacy = {
      fingerprint: '100:60',
      savedAt: Date.now(),
      phase: 'playing',
      mulliganCount: 0,
      resistance: false,
      resistanceState: null,
      state: {
        zones: { library: [], hand: [], graveyard: [], exile: [], command: [] },
        battlefield: [],
        rngSeed: 42,
        turn: 3,
      },
    };
    localStorage.setItem('spellcontrol:playtest:deck-1', JSON.stringify(legacy));
    const loaded = loadPlaytestSnapshot('deck-1', '100:60');
    expect(loaded).not.toBeNull();
    expect(loaded?.state).not.toHaveProperty('life');
  });

  it('rejects a snapshot whose life field is present but malformed', () => {
    localStorage.setItem(
      'spellcontrol:playtest:deck-1',
      JSON.stringify(baseSnapshot({ state: { ...baseState(), life: 'a lot' as never } }))
    );
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  it('rejects a snapshot whose opponents field is present but not an array', () => {
    localStorage.setItem(
      'spellcontrol:playtest:deck-1',
      JSON.stringify(baseSnapshot({ state: { ...baseState(), opponents: 'nope' as never } }))
    );
    expect(loadPlaytestSnapshot('deck-1', '100:60')).toBeNull();
  });

  describe('migrateSnapshotState', () => {
    it('passes a state that already has life fields through unchanged', () => {
      const state = baseState();
      expect(migrateSnapshotState(state, { format: 'commander' })).toBe(state);
    });

    it('backfills commander defaults (40 life, 3 opponents, 21 threshold) when format is commander-family', () => {
      const legacy = {
        zones: baseState().zones,
        battlefield: [],
        rngSeed: 1,
        turn: 1,
      } as unknown as Omit<PlaytestState, 'past'>;
      const migrated = migrateSnapshotState(legacy, { format: 'commander' });
      expect(migrated.life).toBe(40);
      expect(migrated.opponents).toEqual([
        { life: 40, commanderDamage: 0 },
        { life: 40, commanderDamage: 0 },
        { life: 40, commanderDamage: 0 },
      ]);
      expect(migrated.commanderDamageThreshold).toBe(21);
      expect(migrated.tableDefeatedTurn).toBeNull();
    });

    it('backfills paupercommander defaults (30 life, 16 threshold)', () => {
      const legacy = {
        zones: baseState().zones,
        battlefield: [],
        rngSeed: 1,
        turn: 1,
      } as unknown as Omit<PlaytestState, 'past'>;
      const migrated = migrateSnapshotState(legacy, { format: 'paupercommander' });
      expect(migrated.life).toBe(30);
      expect(migrated.opponents).toHaveLength(3);
      expect(migrated.commanderDamageThreshold).toBe(16);
    });

    it('falls back to the generic 1v1/20-life config when there is no deck', () => {
      const legacy = {
        zones: baseState().zones,
        battlefield: [],
        rngSeed: 1,
        turn: 1,
      } as unknown as Omit<PlaytestState, 'past'>;
      const migrated = migrateSnapshotState(legacy, undefined);
      expect(migrated.life).toBe(20);
      expect(migrated.opponents).toEqual([{ life: 20, commanderDamage: 0 }]);
      expect(migrated.commanderDamageThreshold).toBe(21);
    });
  });
});
