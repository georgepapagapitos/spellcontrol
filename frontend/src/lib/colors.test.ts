import { describe, it, expect } from 'vitest';
import { colorSelectionMatches } from './colors';

describe('colorSelectionMatches', () => {
  const boros = { key: 'M', ci: ['R', 'W'] };
  const naya = { key: 'M', ci: ['R', 'G', 'W'] };
  const monoRed = { key: 'R', ci: ['R'] };
  const colorless = { key: 'C', ci: [] as string[] };

  it('matches everything when nothing is selected', () => {
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, new Set())).toBe(true);
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, new Set(), 'all')).toBe(true);
  });

  it("'any' matches when any selected color is present (historical default)", () => {
    const rw = new Set(['R', 'W']);
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, rw)).toBe(true);
    expect(colorSelectionMatches(boros.key, boros.ci, rw)).toBe(true);
    expect(colorSelectionMatches('U', ['U'], rw)).toBe(false);
  });

  it("'all' requires every selected color — R+W means Boros, not mono-red", () => {
    const rw = new Set(['R', 'W']);
    expect(colorSelectionMatches(boros.key, boros.ci, rw, 'all')).toBe(true);
    expect(colorSelectionMatches(naya.key, naya.ci, rw, 'all')).toBe(true);
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, rw, 'all')).toBe(false);
    expect(colorSelectionMatches('W', ['W'], rw, 'all')).toBe(false);
  });

  it("treats 'C' as colorless in both modes", () => {
    expect(colorSelectionMatches(colorless.key, colorless.ci, new Set(['C']))).toBe(true);
    expect(colorSelectionMatches(colorless.key, colorless.ci, new Set(['C']), 'all')).toBe(true);
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, new Set(['C']))).toBe(false);
    // C + R in 'all' mode is unsatisfiable — matches nothing.
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, new Set(['C', 'R']), 'all')).toBe(false);
    // …but in 'any' mode it's "colorless or red".
    expect(colorSelectionMatches(colorless.key, colorless.ci, new Set(['C', 'R']))).toBe(true);
  });

  it('falls back to the grouping key when colorIdentity is missing (basic-land name fallback)', () => {
    expect(colorSelectionMatches('G', [], new Set(['G']))).toBe(true);
    expect(colorSelectionMatches('G', [], new Set(['G']), 'all')).toBe(true);
  });
});
