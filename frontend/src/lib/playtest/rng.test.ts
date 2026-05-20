import { describe, it, expect } from 'vitest';
import { mulberry32, nextSeed, shuffle } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const aOut = [a(), a(), a(), a()];
    const bOut = [b(), b(), b(), b()];
    expect(aOut).toEqual(bOut);
  });

  it('produces values in [0, 1)', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});

describe('shuffle', () => {
  it('returns a permutation (same elements, possibly different order)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = shuffle(input, mulberry32(7));
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = input.slice();
    shuffle(input, mulberry32(7));
    expect(input).toEqual(snapshot);
  });

  it('is deterministic for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(shuffle(input, mulberry32(11))).toEqual(shuffle(input, mulberry32(11)));
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle([7], mulberry32(1))).toEqual([7]);
  });
});

describe('nextSeed', () => {
  it('is deterministic', () => {
    expect(nextSeed(123)).toEqual(nextSeed(123));
  });

  it('produces an unsigned 32-bit integer', () => {
    const s = nextSeed(987654321);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
