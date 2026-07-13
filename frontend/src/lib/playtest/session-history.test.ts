// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { appendSessionRecord, loadSessionHistory } from './session-history';
import type { PlaytestSessionRecord } from './session-record';

function makeRecord(overrides: Partial<PlaytestSessionRecord> = {}): PlaytestSessionRecord {
  return {
    id: `r-${Math.random()}`,
    deckId: 'deck-1',
    endedAt: Date.now(),
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

beforeEach(() => localStorage.clear());

describe('loadSessionHistory', () => {
  it('returns an empty array when nothing is saved', () => {
    expect(loadSessionHistory('deck-none')).toEqual([]);
  });

  it('rejects corrupt JSON without throwing', () => {
    localStorage.setItem('spellcontrol:playtest-history:deck-1', 'not-json{{{');
    expect(() => loadSessionHistory('deck-1')).not.toThrow();
    expect(loadSessionHistory('deck-1')).toEqual([]);
  });

  it('rejects a non-array payload', () => {
    localStorage.setItem('spellcontrol:playtest-history:deck-1', JSON.stringify({ foo: 'bar' }));
    expect(loadSessionHistory('deck-1')).toEqual([]);
  });

  it('filters out malformed records but keeps valid ones', () => {
    const good = makeRecord({ id: 'good' });
    localStorage.setItem(
      'spellcontrol:playtest-history:deck-1',
      JSON.stringify([good, { id: 'bad', missing: 'fields' }])
    );
    const loaded = loadSessionHistory('deck-1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('good');
  });
});

describe('appendSessionRecord', () => {
  it('appends and round-trips a record', () => {
    const record = makeRecord({ id: 'r1' });
    appendSessionRecord('deck-1', record);
    expect(loadSessionHistory('deck-1')).toEqual([record]);
  });

  it('accumulates multiple records in order', () => {
    appendSessionRecord('deck-1', makeRecord({ id: 'r1' }));
    appendSessionRecord('deck-1', makeRecord({ id: 'r2' }));
    const history = loadSessionHistory('deck-1');
    expect(history.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps deck histories isolated by key', () => {
    appendSessionRecord('deck-a', makeRecord({ id: 'a1', deckId: 'deck-a' }));
    appendSessionRecord('deck-b', makeRecord({ id: 'b1', deckId: 'deck-b' }));
    expect(loadSessionHistory('deck-a').map((r) => r.id)).toEqual(['a1']);
    expect(loadSessionHistory('deck-b').map((r) => r.id)).toEqual(['b1']);
  });

  it('prunes to the most recent 50 records, oldest first dropped', () => {
    for (let i = 0; i < 55; i++) {
      appendSessionRecord('deck-1', makeRecord({ id: `r${i}` }));
    }
    const history = loadSessionHistory('deck-1');
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe('r5');
    expect(history.at(-1)?.id).toBe('r54');
  });

  it('discards a pre-existing corrupt blob rather than blocking the append', () => {
    localStorage.setItem('spellcontrol:playtest-history:deck-1', 'not-json{{{');
    const record = makeRecord({ id: 'r1' });
    expect(() => appendSessionRecord('deck-1', record)).not.toThrow();
    expect(loadSessionHistory('deck-1')).toEqual([record]);
  });
});
