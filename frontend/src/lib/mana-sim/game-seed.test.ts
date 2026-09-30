import { describe, expect, it } from 'vitest';
import { gameSeed } from './game-seed';

describe('gameSeed', () => {
  it('is a pure function of (seed, game)', () => {
    expect(gameSeed(7, 3)).toBe(gameSeed(7, 3));
    expect(gameSeed(7, 3)).not.toBe(gameSeed(7, 4));
    expect(gameSeed(7, 3)).not.toBe(gameSeed(8, 3));
  });

  it('spreads neighbouring games across the 32-bit range', () => {
    const seeds = new Set(Array.from({ length: 10000 }, (_, g) => gameSeed(20260929, g)));
    expect(seeds.size).toBe(10000);
    const high = [...seeds].filter((s) => s >= 2 ** 31).length;
    expect(high / seeds.size).toBeGreaterThan(0.45);
    expect(high / seeds.size).toBeLessThan(0.55);
  });
});
