import { describe, expect, it } from 'vitest';
import {
  fitPairWeights,
  groupFolds,
  heldOut,
  pairAccuracy,
  pairLogLoss,
  type PairExample,
} from './pairFit';
import { rng } from './validation';

/**
 * Synthetic pairs from a known truth: the real deck leads on `a` by a lot and
 * on `b` by a little, and `noise` is pure noise that sometimes points the
 * wrong way. A fit that works weights `a` over `noise`, and the grouped
 * held-out accuracy beats the equal-weight hand score because the hand score
 * lets `noise` outvote `a` and `b`.
 */
function pairs(n: number, seed: number): PairExample[] {
  const next = rng(seed);
  const gauss = () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s += next();
    return s - 3;
  };
  return Array.from({ length: n }, (_, i) => ({
    group: `cmdr-${i % 40}`,
    x: { a: 1 + 0.5 * gauss(), b: 0.15 + 0.05 * gauss(), noise: 3 * gauss() },
  }));
}

describe('pairFit', () => {
  const ex = pairs(600, 4);
  const keys = ['a', 'b', 'noise'];

  it('counts a tie as half and a loss as zero', () => {
    const w = { a: 1 };
    expect(pairAccuracy([{ group: 'g', x: { a: 0 } }], w)).toBe(0.5);
    expect(pairAccuracy([{ group: 'g', x: { a: -1 } }], w)).toBe(0);
    expect(pairAccuracy([{ group: 'g', x: { a: 2 } }], w)).toBe(1);
    expect(pairLogLoss([{ group: 'g', x: { a: 0 } }], w)).toBeCloseTo(Math.log(2), 10);
  });

  it('deals each group to exactly one fold, deterministically', () => {
    const groups = ex.map((e) => e.group);
    const a = groupFolds(groups, 5, 3);
    expect([...a.values()].every((f) => f >= 0 && f < 5)).toBe(true);
    expect(a.size).toBe(40);
    expect([...groupFolds(groups, 5, 3)]).toEqual([...a]);
  });

  it('puts the weight on the term that carries the signal', () => {
    const w = fitPairWeights(ex, keys, 0.01);
    expect(w.a).toBeGreaterThan(w.noise);
    expect(Object.values(w).reduce((s, v) => s + v, 0) / 3).toBeCloseTo(1, 6);
    expect(Object.values(w).every((v) => v >= 0)).toBe(true);
  });

  it('beats equal weights on held-out commanders', () => {
    const rep = heldOut(ex, keys, 5, 2);
    expect(rep.n).toBe(ex.length);
    expect(rep.fitted).toBeGreaterThan(rep.hand);
    expect(rep.fittedLogLoss).toBeLessThan(rep.handLogLoss);
    expect(rep.pairs).toHaveLength(ex.length);
  });
});
