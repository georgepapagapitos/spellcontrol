import { describe, expect, it } from 'vitest';
import { computeStreak, previousDay } from './streak';

const s = (date: string, solved = true) => ({ date, solved });

describe('previousDay', () => {
  it('crosses month and year boundaries', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('computeStreak', () => {
  it('is 0 with no results', () => {
    expect(computeStreak([], '2026-09-10')).toBe(0);
  });
  it('counts today and earlier days', () => {
    expect(computeStreak([s('2026-09-10'), s('2026-09-09')], '2026-09-10')).toBe(2);
  });
  it('ends yesterday when today is unplayed', () => {
    expect(computeStreak([s('2026-09-09'), s('2026-09-08')], '2026-09-10')).toBe(2);
  });
  it('is 0 when today failed', () => {
    expect(computeStreak([s('2026-09-10', false), s('2026-09-09')], '2026-09-10')).toBe(0);
  });
  it('breaks on a failed day', () => {
    expect(
      computeStreak([s('2026-09-10'), s('2026-09-09', false), s('2026-09-08')], '2026-09-10')
    ).toBe(1);
  });
  it('breaks on a gap', () => {
    expect(computeStreak([s('2026-09-10'), s('2026-09-08')], '2026-09-10')).toBe(1);
  });
  it('ignores days after the date', () => {
    expect(computeStreak([s('2026-09-11'), s('2026-09-09')], '2026-09-10')).toBe(1);
  });
});
