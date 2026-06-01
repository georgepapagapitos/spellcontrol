import { describe, expect, it } from 'vitest';
import {
  gradeCurve,
  gradeFromDeviation,
  gradePhase,
  pacingAwarePhaseTargets,
} from './curveGrading';

describe('pacingAwarePhaseTargets', () => {
  it('returns the base 45/35/20 band for balanced pacing', () => {
    const t = pacingAwarePhaseTargets('balanced');
    expect(t.early).toBeCloseTo(0.45, 5);
    expect(t.mid).toBeCloseTo(0.35, 5);
    expect(t.late).toBeCloseTo(0.2, 5);
  });

  it('always renormalizes to a valid share distribution (sums to 1)', () => {
    for (const pacing of [
      'aggressive-early',
      'fast-tempo',
      'midrange',
      'late-game',
      'balanced',
    ] as const) {
      const t = pacingAwarePhaseTargets(pacing);
      expect(t.early + t.mid + t.late).toBeCloseTo(1, 5);
    }
  });

  it('shifts the band earlier for aggressive and later for late-game', () => {
    const base = pacingAwarePhaseTargets('balanced');
    const aggro = pacingAwarePhaseTargets('aggressive-early');
    const late = pacingAwarePhaseTargets('late-game');
    expect(aggro.early).toBeGreaterThan(base.early);
    expect(aggro.late).toBeLessThan(base.late);
    expect(late.late).toBeGreaterThan(base.late);
    expect(late.early).toBeLessThan(base.early);
  });
});

describe('gradeFromDeviation', () => {
  it('maps deviation magnitude to letter bands', () => {
    expect(gradeFromDeviation(0)).toBe('A');
    expect(gradeFromDeviation(0.1)).toBe('A');
    expect(gradeFromDeviation(0.15)).toBe('B');
    expect(gradeFromDeviation(0.3)).toBe('C');
    expect(gradeFromDeviation(0.5)).toBe('D');
    expect(gradeFromDeviation(0.6)).toBe('F');
  });
});

describe('gradePhase', () => {
  it('does not penalize early/mid for being over target (one-sided)', () => {
    expect(gradePhase('early', 0.6, 0.45)).toBe('A');
    expect(gradePhase('mid', 0.5, 0.35)).toBe('A');
  });

  it('penalizes early/mid for being under target', () => {
    expect(gradePhase('early', 0.3, 0.45)).toBe('C'); // (0.45-0.30)/0.45 = 0.33
  });

  it('penalizes late for deviating in either direction (top-heavy hurts)', () => {
    expect(gradePhase('late', 0.2, 0.2)).toBe('A');
    expect(gradePhase('late', 0.4, 0.2)).toBe('F'); // double the target → way over
  });
});

describe('gradeCurve', () => {
  // Curves chosen to land in known pacing buckets (see estimatePacingFromStats).
  const AGGRO = { 1: 20, 2: 20, 3: 8, 4: 2 }; // avg 1.84, early 80%
  const LATE = { 4: 18, 5: 6, 6: 1 }; // avg 4.32 → late-game, late 28%
  const MID = { 2: 10, 3: 12, 4: 8 }; // avg 2.93, mid 67%

  it('detects the deck pacing from its own curve', () => {
    expect(gradeCurve(AGGRO).pacing).toBe('aggressive-early');
    expect(gradeCurve(LATE).pacing).toBe('late-game');
    expect(gradeCurve(MID).pacing).toBe('midrange');
  });

  it('grades each phase against a pacing-shifted target', () => {
    const aggro = gradeCurve(AGGRO);
    const late = gradeCurve(LATE);
    // Aggressive decks are judged against a heavier-early / lighter-late band.
    expect(aggro.phases.find((p) => p.key === 'early')!.target).toBeGreaterThan(0.45);
    // Late-game decks get a heavier-late band, so a top-end-rich deck near that
    // band grades well instead of being dinged against the static 20%.
    const lateLate = late.phases.find((p) => p.key === 'late')!;
    expect(lateLate.target).toBeGreaterThan(0.2);
    expect(lateLate.grade).toBe('A');
  });

  it('reports counts and total, and handles an empty curve', () => {
    const aggro = gradeCurve(AGGRO);
    expect(aggro.total).toBe(50);
    expect(aggro.phases.find((p) => p.key === 'early')!.count).toBe(40);

    const empty = gradeCurve({});
    expect(empty.total).toBe(0);
    expect(empty.phases).toHaveLength(3);
  });
});
