import { describe, expect, it } from 'vitest';
import { formatCount } from './format-count';

describe('formatCount', () => {
  it('renders sub-1000 counts as plain integers', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(5)).toBe('5');
    expect(formatCount(999)).toBe('999');
  });

  it('renders 1000-9999 with one decimal, trimming a trailing .0', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1200)).toBe('1.2k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(9500)).toBe('9.5k');
  });

  it('renders 10000+ as a rounded whole-number k', () => {
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(12_345)).toBe('12k');
    expect(formatCount(250_000)).toBe('250k');
  });
});
