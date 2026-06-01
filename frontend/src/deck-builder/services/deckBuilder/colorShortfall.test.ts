import { describe, expect, it } from 'vitest';
import {
  BASE_MIN_FLAG_DEMAND,
  BASE_SHORTFALL_RATIO,
  isColorShort,
  pacingAwareShortfallThresholds,
  shortfallThresholdsForCurve,
} from './colorShortfall';

describe('pacingAwareShortfallThresholds', () => {
  it('returns the base ratio/demand for balanced and midrange pacing', () => {
    for (const pacing of ['balanced', 'midrange'] as const) {
      const t = pacingAwareShortfallThresholds(pacing);
      expect(t.ratio).toBeCloseTo(BASE_SHORTFALL_RATIO, 5);
      expect(t.minDemand).toBe(BASE_MIN_FLAG_DEMAND);
    }
  });

  it('judges aggressive decks stricter (higher coverage bar, smaller splash floor)', () => {
    const t = pacingAwareShortfallThresholds('aggressive-early');
    expect(t.ratio).toBeGreaterThan(BASE_SHORTFALL_RATIO);
    expect(t.minDemand).toBeLessThanOrEqual(BASE_MIN_FLAG_DEMAND);
  });

  it('judges late-game decks more forgiving (lower bar, higher splash floor)', () => {
    const t = pacingAwareShortfallThresholds('late-game');
    expect(t.ratio).toBeLessThan(BASE_SHORTFALL_RATIO);
    expect(t.minDemand).toBeGreaterThan(BASE_MIN_FLAG_DEMAND);
  });

  it('keeps the ratio in a sane band and the demand floor an integer >= 1', () => {
    for (const pacing of [
      'aggressive-early',
      'fast-tempo',
      'midrange',
      'late-game',
      'balanced',
    ] as const) {
      const t = pacingAwareShortfallThresholds(pacing);
      expect(t.ratio).toBeGreaterThanOrEqual(0.3);
      expect(t.ratio).toBeLessThanOrEqual(0.9);
      expect(Number.isInteger(t.minDemand)).toBe(true);
      expect(t.minDemand).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('shortfallThresholdsForCurve', () => {
  // Curves chosen to land in known pacing buckets (see estimatePacingFromStats).
  const AGGRO = { 1: 20, 2: 20, 3: 8, 4: 2 }; // avg 1.84, early 80% → aggressive-early
  const LATE = { 4: 18, 5: 6, 6: 1 }; // avg 4.32 → late-game

  it('derives pacing from the curve and yields stricter thresholds for aggressive than late', () => {
    const aggro = shortfallThresholdsForCurve(AGGRO);
    const late = shortfallThresholdsForCurve(LATE);
    expect(aggro.pacing).toBe('aggressive-early');
    expect(late.pacing).toBe('late-game');
    expect(aggro.ratio).toBeGreaterThan(late.ratio);
    expect(aggro.minDemand).toBeLessThan(late.minDemand);
  });

  it('treats an empty curve as balanced (base thresholds)', () => {
    const t = shortfallThresholdsForCurve({});
    expect(t.pacing).toBe('balanced');
    expect(t.ratio).toBeCloseTo(BASE_SHORTFALL_RATIO, 5);
    expect(t.minDemand).toBe(BASE_MIN_FLAG_DEMAND);
  });
});

describe('isColorShort', () => {
  const base = { ratio: BASE_SHORTFALL_RATIO, minDemand: BASE_MIN_FLAG_DEMAND };

  it('never flags a color with no demand', () => {
    expect(isColorShort(0, 0, base)).toBe(false);
    expect(isColorShort(0, 5, base)).toBe(false);
  });

  it('always flags demand with zero sources, even below the splash floor', () => {
    expect(isColorShort(2, 0, base)).toBe(true); // demand 2 < minDemand 3, but zero sources
  });

  it('forgives a small splash under the demand floor when it has any source', () => {
    expect(isColorShort(2, 1, base)).toBe(false); // 1 < 1.2 but demand 2 < minDemand 3
  });

  it('flags a well-leaned color whose sources fall under the coverage bar', () => {
    expect(isColorShort(15, 4, base)).toBe(true); // 4 < 9 and demand >= 3
  });

  it('does not flag a color whose sources clear the coverage bar', () => {
    expect(isColorShort(15, 10, base)).toBe(false); // 10 >= 9
  });

  it('respects a stricter (aggressive) threshold', () => {
    const aggro = pacingAwareShortfallThresholds('aggressive-early');
    // demand 2, one source: forgiven at base (minDemand 3) but flagged when the
    // aggressive floor drops to 2 and the source fails the higher coverage bar.
    expect(isColorShort(2, 1, base)).toBe(false);
    expect(isColorShort(2, 1, aggro)).toBe(true); // 1 < 2*0.70=1.4 and demand 2 >= 2
  });
});
