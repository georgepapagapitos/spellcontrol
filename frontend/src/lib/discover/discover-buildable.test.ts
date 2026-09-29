import { describe, expect, it } from 'vitest';
import { computeBuildablePercent } from './discover-buildable';

describe('computeBuildablePercent', () => {
  it('is 100 for a fully-owned deck', () => {
    expect(computeBuildablePercent(['a', 'b', 'c'], new Set(['a', 'b', 'c', 'z']))).toBe(100);
  });

  it('is 0 for a none-owned deck, not NaN', () => {
    expect(computeBuildablePercent(['a', 'b', 'c'], new Set(['x', 'y']))).toBe(0);
  });

  it('is 0, not NaN, for an empty cardOracleIds array', () => {
    expect(computeBuildablePercent([], new Set(['a', 'b']))).toBe(0);
    expect(computeBuildablePercent([], new Set())).toBe(0);
  });

  it('rounds fractional ownership correctly', () => {
    // 1/3 -> 33.33... -> 33
    expect(computeBuildablePercent(['a', 'b', 'c'], new Set(['a']))).toBe(33);
    // 2/3 -> 66.66... -> 67
    expect(computeBuildablePercent(['a', 'b', 'c'], new Set(['a', 'b']))).toBe(67);
    // 5/8 -> 62.5 -> 63 (round-half-up)
    expect(
      computeBuildablePercent(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        new Set(['a', 'b', 'c', 'd', 'e'])
      )
    ).toBe(63);
  });

  it('ignores owned ids that are not in the deck', () => {
    expect(computeBuildablePercent(['a'], new Set(['a', 'unrelated-1', 'unrelated-2']))).toBe(100);
  });
});
