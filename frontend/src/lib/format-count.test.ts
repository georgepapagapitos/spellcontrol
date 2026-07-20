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
});
