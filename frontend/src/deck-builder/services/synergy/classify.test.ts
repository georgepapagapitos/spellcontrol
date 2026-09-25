import { describe, it, expect } from 'vitest';
import { classifyCard } from './classify';
import { CORPUS } from './classify.fixtures';
import type { AxisKey } from './axes';

const sorted = (a: AxisKey[]) => [...a].sort();
const axesOf = (roles: { axis: AxisKey }[]) => sorted(roles.map((r) => r.axis));

describe('synergy classifier — labeled corpus', () => {
  // Per-card exact match: the strongest gate. If this fails it prints the
  // offending card + expected/actual so the predicate (or label) can be fixed.
  for (const c of CORPUS) {
    it(`classifies ${c.name}`, () => {
      const res = classifyCard(c);
      expect({ producers: axesOf(res.producers), payoffs: axesOf(res.payoffs) }).toEqual({
        producers: sorted(c.expect.producers),
        payoffs: sorted(c.expect.payoffs),
      });
    });
  }
});

describe('synergy classifier — safety invariants', () => {
  it('never tags "Its controller creates …" removal as a token producer', () => {
    for (const name of ['Beast Within', 'Generous Gift', 'Stroke of Midnight']) {
      const card = CORPUS.find((c) => c.name === name)!;
      const res = classifyCard(card);
      expect(res.producers).toEqual([]);
    }
  });

  it('never counts a drain\'s "and you gain N life" as a lifegain source', () => {
    // The Mr. House review read "Lifegain: 8 sources · 0 payoffs" off exactly
    // these; Soul Warden's gain is the whole clause and is a real source.
    for (const name of ['Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant']) {
      const card = CORPUS.find((c) => c.name === name)!;
      expect(classifyCard(card).producers.map((r) => r.axis)).not.toContain('lifegain');
    }
    const warden = CORPUS.find((c) => c.name === 'Soul Warden')!;
    expect(classifyCard(warden).producers.map((r) => r.axis)).toContain('lifegain');
  });

  it('reports an aggregate precision/recall ≥ 0.9 on producers and payoffs', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const c of CORPUS) {
      const res = classifyCard(c);
      const got = new Set([
        ...res.producers.map((r) => `P:${r.axis}`),
        ...res.payoffs.map((r) => `O:${r.axis}`),
      ]);
      const want = new Set([
        ...c.expect.producers.map((a) => `P:${a}`),
        ...c.expect.payoffs.map((a) => `O:${a}`),
      ]);
      for (const g of got) {
        if (want.has(g)) tp++;
        else fp++;
      }
      for (const w of want) if (!got.has(w)) fn++;
    }
    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});

// E412: the deck page classifies the same card objects many times per load
// (every deck's profile for the cross-deck scan, then per-candidate hits, the
// radar, and every recompute). The result is cached per card OBJECT: a second
// call is free, and a different copy of a card is still read from its own text.
describe('synergy classifier — per-object cache (E412)', () => {
  const tokenMaker = {
    name: 'Cache Probe',
    type_line: 'Sorcery',
    oracle_text: 'Create two 1/1 white Soldier creature tokens.',
  };

  it('returns the cached result for the same card object', () => {
    expect(classifyCard(tokenMaker)).toBe(classifyCard(tokenMaker));
  });

  it('classifies a different object from its own text, even under the same name', () => {
    const other = { ...tokenMaker, oracle_text: 'Draw a card.' };
    expect(axesOf(classifyCard(tokenMaker).producers)).toContain('tokens');
    expect(axesOf(classifyCard(other).producers)).not.toContain('tokens');
  });
});
