import { describe, it, expect } from 'vitest';
import { formatCount } from './format-count';

describe('formatCount', () => {
  it('renders sub-1000 counts verbatim', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands to one decimal, dropping a trailing .0', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1234)).toBe('1.2k');
    expect(formatCount(9499)).toBe('9.5k');
  });

  it('rounds to a whole k at 10,000 and above (and just under, via the .0 rounding)', () => {
    expect(formatCount(9999)).toBe('10k');
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(12_345)).toBe('12k');
  });

  it('switches to millions without ever reading "1000k"', () => {
    expect(formatCount(999_499)).toBe('999k');
    expect(formatCount(999_500)).toBe('1M');
    expect(formatCount(4_666_671)).toBe('4.7M');
    expect(formatCount(8_456_145)).toBe('8.5M');
    expect(formatCount(10_153_350)).toBe('10M');
    expect(formatCount(12_600_000)).toBe('13M');
  });

  it('reads a missing number as 0', () => {
    expect(formatCount(Number.NaN)).toBe('0');
  });
});
