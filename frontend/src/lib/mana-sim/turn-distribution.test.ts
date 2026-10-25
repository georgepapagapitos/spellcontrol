import { describe, expect, it } from 'vitest';
import { DISTRIBUTION_TURNS, summarizeTurns, wilsonInterval } from './turn-distribution';

describe('wilsonInterval', () => {
  it('matches the published score interval for 8 of 10', () => {
    // Wilson 95% for 8/10: [0.4902, 0.9433] (Brown, Cai & DasGupta 2001, table).
    const { lo, hi } = wilsonInterval(8, 10);
    expect(lo).toBeCloseTo(0.4902, 3);
    expect(hi).toBeCloseTo(0.9433, 3);
  });

  it('is not degenerate at the ends, where "never in 1,000 games" lives', () => {
    const none = wilsonInterval(0, 1000);
    expect(none.lo).toBeCloseTo(0, 10);
    expect(none.hi).toBeGreaterThan(0);
    expect(none.hi).toBeLessThan(0.005);
    const all = wilsonInterval(1000, 1000);
    expect(all.hi).toBeCloseTo(1, 10);
    expect(all.lo).toBeGreaterThan(0.995);
  });

  it('narrows as the run count grows', () => {
    const small = wilsonInterval(30, 100);
    const big = wilsonInterval(3000, 10000);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });

  it('reads an empty sample as knowing nothing', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe('summarizeTurns', () => {
  it('reports the median, p90 and the best-5% ceiling of the turns', () => {
    const turns = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100, shuffled order is irrelevant
    const d = summarizeTurns([...turns].reverse());
    expect(d.runs).toBe(100);
    expect(d.typicalTurn).toBe(51);
    expect(d.p90Turn).toBe(91);
    expect(d.ceilingTurn).toBe(6);
  });

  it('shares by turn count the games finished by it, each inside its interval', () => {
    const d = summarizeTurns([...new Array(30).fill(3), ...new Array(70).fill(9)]);
    expect(d.assembledBy).toHaveLength(DISTRIBUTION_TURNS + 1);
    expect(d.assembledBy[2]).toBe(0);
    expect(d.assembledBy[3]).toBeCloseTo(0.3);
    expect(d.assembledBy[8]).toBeCloseTo(0.3);
    expect(d.assembledBy[9]).toBe(1);
    for (const s of d.byTurn) {
      expect(s.lo).toBeLessThanOrEqual(s.p);
      expect(s.hi).toBeGreaterThanOrEqual(s.p);
    }
    expect(d.byTurn[3].lo).toBeLessThan(0.3);
    expect(d.byTurn[3].hi).toBeGreaterThan(0.3);
  });

  it('puts a game that never finishes past the horizon, not in any share', () => {
    const d = summarizeTurns([5, 5, 99, 99]);
    expect(d.assembledBy[DISTRIBUTION_TURNS]).toBe(0.5);
    expect(d.p90Turn).toBe(99);
  });
});
