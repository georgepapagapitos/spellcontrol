import { describe, it, expect } from 'vitest';
import { colorIdentityWords, colorSelectionMatches } from './colors';

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

  it("'all' is exact — R+W means Boros, not mono-red and not Naya", () => {
    const rw = new Set(['R', 'W']);
    expect(colorSelectionMatches(boros.key, boros.ci, rw, 'all')).toBe(true);
    // Naya carries green, which wasn't picked — an exact match excludes it.
    expect(colorSelectionMatches(naya.key, naya.ci, rw, 'all')).toBe(false);
    expect(colorSelectionMatches(monoRed.key, monoRed.ci, rw, 'all')).toBe(false);
    expect(colorSelectionMatches('W', ['W'], rw, 'all')).toBe(false);
  });

  it("'all' with one pip means mono — a lone Blue excludes every card carrying another color", () => {
    const u = new Set(['U']);
    expect(colorSelectionMatches('U', ['U'], u, 'all')).toBe(true);
    expect(colorSelectionMatches('M', ['U', 'R'], u, 'all')).toBe(false);
    expect(colorSelectionMatches('M', ['W', 'U', 'B', 'R', 'G'], u, 'all')).toBe(false);
    // 'any' still means "anything containing blue".
    expect(colorSelectionMatches('M', ['U', 'R'], u)).toBe(true);
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

// Guild and shard names (Esper, Boros) mean nothing to a newer player, so the
// deck's colors read as plain words beside the pips.
describe('colorIdentityWords', () => {
  it('names one color as mono', () => {
    expect(colorIdentityWords(['W'])).toBe('Mono-white');
  });

  it('joins two colors with "and"', () => {
    expect(colorIdentityWords(['W', 'U'])).toBe('White and blue');
  });

  it('lists three or more with a final "and"', () => {
    expect(colorIdentityWords(['W', 'U', 'B'])).toBe('White, blue and black');
  });

  it('reads an empty identity as colorless', () => {
    expect(colorIdentityWords([])).toBe('Colorless');
  });
});
