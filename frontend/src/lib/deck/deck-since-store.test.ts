// @vitest-environment happy-dom
import { beforeEach, describe, it, expect } from 'vitest';
import type { DeckSnapshot } from './deck-since';
import {
  MAX_RECORDS,
  SESSION_GAP_MS,
  clearRecord,
  loadRecord,
  markSeen,
  observe,
  saveRecord,
  startSession,
} from './deck-since-store';

const snap = (
  at: number,
  cards: Record<string, number>,
  metrics: DeckSnapshot['metrics'] = {}
): DeckSnapshot => ({ at, cards, commanders: [], metrics });

const rec = (baseline: DeckSnapshot, latest: DeckSnapshot) => ({ baseline, latest, pool: {} });

beforeEach(() => localStorage.clear());

describe('startSession', () => {
  it('seeds baseline and latest from the first visit', () => {
    const now = snap(100, { 'Sol Ring': 1 });
    expect(startSession(null, now, 100)).toEqual({ baseline: now, latest: now, pool: {} });
  });

  it('keeps the baseline for a quick return, so the session edits stay on screen', () => {
    const rec0 = rec(snap(0, { a: 1 }), snap(1000, { a: 1, b: 1 }));
    expect(startSession(rec0, snap(2000, { a: 1, b: 1 }), 1000 + SESSION_GAP_MS)).toBe(rec0);
  });

  it('promotes latest to baseline after a long gap', () => {
    const rec0 = rec(snap(0, { a: 1 }), snap(1000, { a: 1, b: 1 }));
    const next = startSession(rec0, snap(9e9, { a: 1, b: 1 }), 1001 + SESSION_GAP_MS);
    expect(next.baseline).toBe(rec0.latest);
    expect(next.latest).toBe(rec0.latest);
  });
});

describe('observe', () => {
  it('records the latest snapshot and leaves the baseline once cards differ', () => {
    const rec0 = rec(snap(0, { a: 1 }, { lands: 1 }), snap(0, { a: 1 }));
    const now = snap(5, { a: 1, b: 1 }, { lands: 2 });
    const next = observe(rec0, now);
    expect(next.baseline).toBe(rec0.baseline);
    expect(next.latest).toBe(now);
  });

  it('fills metrics the baseline was missing while the cards still match', () => {
    const rec0 = rec(snap(0, { a: 1 }, { lands: 1 }), snap(0, { a: 1 }));
    const next = observe(rec0, snap(5, { a: 1 }, { lands: 1, bracket: 3, ramp: 4 }));
    expect(next.baseline.metrics).toEqual({ lands: 1, bracket: 3, ramp: 4 });
  });

  it('never overwrites a baseline metric', () => {
    const rec0 = rec(snap(0, { a: 1 }, { lands: 1 }), snap(0, { a: 1 }));
    expect(observe(rec0, snap(5, { a: 1 }, { lands: 9 })).baseline.metrics.lands).toBe(1);
  });
});

describe('markSeen', () => {
  it('makes the current state the baseline', () => {
    const rec0 = rec(snap(0, { a: 1 }), snap(5, { a: 1, b: 1 }));
    expect(markSeen(rec0).baseline).toBe(rec0.latest);
  });
});

describe('persistence', () => {
  const rec0 = rec(snap(0, { a: 1 }), snap(5, { a: 2 }));

  it('round-trips a record and clears it', () => {
    saveRecord('d1', rec0);
    expect(loadRecord('d1')).toEqual(rec0);
    clearRecord('d1');
    expect(loadRecord('d1')).toBeNull();
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem('deck-since-v1', '{nope');
    expect(loadRecord('d1')).toBeNull();
    localStorage.setItem('deck-since-v1', JSON.stringify({ d1: { baseline: 3 } }));
    expect(loadRecord('d1')).toBeNull();
  });

  it('drops the least recently changed decks past the cap', () => {
    for (let i = 0; i < MAX_RECORDS + 3; i++) {
      saveRecord(`d${i}`, rec(snap(i, {}), snap(i, {})));
    }
    expect(loadRecord('d0')).toBeNull();
    expect(loadRecord('d2')).toBeNull();
    expect(loadRecord('d3')).not.toBeNull();
    expect(loadRecord(`d${MAX_RECORDS + 2}`)).not.toBeNull();
  });
});
