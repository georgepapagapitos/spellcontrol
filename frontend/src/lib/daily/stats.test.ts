import { describe, it, expect } from 'vitest';
import {
  bestStreak,
  computeStats,
  computeStreak,
  mergeResults,
  previousDay,
  type DailyResult,
} from './stats';

const r = (date: string, solved = true, guesses = 3): DailyResult => ({ date, solved, guesses });

describe('previousDay', () => {
  it('crosses month and year boundaries in UTC', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('computeStreak', () => {
  it('counts back from today when today is solved', () => {
    expect(computeStreak([r('2026-10-03'), r('2026-10-02'), r('2026-10-01')], '2026-10-03')).toBe(
      3
    );
  });

  it('counts from yesterday while today is still unplayed', () => {
    expect(computeStreak([r('2026-10-02'), r('2026-10-01')], '2026-10-03')).toBe(2);
  });

  it('drops to 0 on a failed today, and a failed or missing day breaks the run', () => {
    expect(computeStreak([r('2026-10-03', false, 6), r('2026-10-02')], '2026-10-03')).toBe(0);
    expect(
      computeStreak([r('2026-10-03'), r('2026-10-02', false, 6), r('2026-10-01')], '2026-10-03')
    ).toBe(1);
    expect(computeStreak([r('2026-10-03'), r('2026-10-01')], '2026-10-03')).toBe(1);
    expect(computeStreak([], '2026-10-03')).toBe(0);
  });
});

describe('bestStreak', () => {
  it('finds the longest solved run anywhere in the history', () => {
    const history = [
      r('2026-10-01'),
      r('2026-10-02'),
      r('2026-10-03'),
      r('2026-10-04', false, 6),
      r('2026-10-05'),
      r('2026-10-06'),
    ];
    expect(bestStreak(history)).toBe(3);
    expect(bestStreak([])).toBe(0);
  });
});

describe('computeStats', () => {
  it('reports played, solved share, streaks and the guess distribution', () => {
    const history = [
      r('2026-10-03', true, 2),
      r('2026-10-02', true, 2),
      r('2026-10-01', false, 6),
      r('2026-09-30', true, 5),
    ];
    expect(computeStats(history, '2026-10-03')).toEqual({
      played: 4,
      solved: 3,
      solvedPct: 75,
      streak: 2,
      best: 2,
      distribution: [0, 2, 0, 0, 1, 0],
    });
  });

  it('reads 0% rather than NaN with no history', () => {
    expect(computeStats([], '2026-10-03').solvedPct).toBe(0);
  });
});

describe('mergeResults', () => {
  it('keeps the first result per date, newest first', () => {
    const merged = mergeResults(
      [r('2026-10-02', true, 2)],
      [r('2026-10-02', true, 5), r('2026-10-03', false, 6)]
    );
    expect(merged).toEqual([r('2026-10-03', false, 6), r('2026-10-02', true, 2)]);
  });
});
