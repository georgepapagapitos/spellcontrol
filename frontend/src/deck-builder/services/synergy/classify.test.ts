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
