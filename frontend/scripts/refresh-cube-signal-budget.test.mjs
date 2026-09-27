// Pure-part tests for refresh-cube-signal-budget.mjs — no network, no fs
// writes. Importing the module does not run `main()` (guarded behind an
// `import.meta.url === process.argv[1]` check), so this is safe to import
// directly under vitest.
import { describe, it, expect } from 'vitest';
import {
  filterCandidates,
  passesSizeFloor,
  unionCubes,
  corpusInclusion,
  cardName,
  MIN_LIKES,
  MIN_MAINBOARD,
} from './refresh-cube-signal-budget.mjs';

describe('filterCandidates', () => {
  const raw = [
    { id: 'a', name: 'The Pauper Cube', visibility: 'pu', likeCount: 3000 },
    { id: 'b', name: "Kyle's Commander Cube", visibility: 'pu', likeCount: 500 }, // name mismatch
    { id: 'c', name: 'Personal Pauper List', visibility: 'pr', likeCount: 999 }, // private
    { id: 'd', name: 'Tiny Pauper Cube', visibility: 'pu', likeCount: 5 }, // under likes floor
    { id: 'e', name: 'A Pauper Cube', visibility: 'pu' }, // likeCount missing
  ];

  it('keeps only public, well-liked, name-matching cubes', () => {
    const out = filterCandidates(raw, /pauper/i);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });

  it('honors an explicit likes floor', () => {
    const out = filterCandidates(raw, /pauper/i, 1);
    expect(out.map((c) => c.id)).toEqual(['a', 'd']);
  });

  it('defaults to MIN_LIKES', () => {
    expect(MIN_LIKES).toBe(10);
    expect(filterCandidates(raw, /pauper/i).every((c) => c.likes >= MIN_LIKES)).toBe(true);
  });
});

describe('passesSizeFloor', () => {
  it('rejects a novelty-sized mainboard (the live "Pets Peasant Cube" case: 10 cards, 52 likes)', () => {
    expect(passesSizeFloor(10)).toBe(false);
  });

  it('accepts a real cube mainboard', () => {
    expect(passesSizeFloor(360)).toBe(true);
  });

  it('defaults to MIN_MAINBOARD = 100', () => {
    expect(MIN_MAINBOARD).toBe(100);
    expect(passesSizeFloor(99)).toBe(false);
    expect(passesSizeFloor(100)).toBe(true);
  });
});

describe('unionCubes', () => {
  it('adds every cube from `own` not already in `base`, by id', () => {
    const base = [{ id: '1', names: new Set(['A']) }];
    const own = [
      { id: '1', names: new Set(['A-dup']) }, // dropped, id already in base
      { id: '2', names: new Set(['B']) },
    ];
    const out = unionCubes(base, own);
    expect(out.map((c) => c.id)).toEqual(['1', '2']);
    // The base's copy of a shared id wins, not the union'd one.
    expect(out[0].names).toEqual(new Set(['A']));
  });

  it('is a no-op when own is empty', () => {
    const base = [{ id: '1', names: new Set(['A']) }];
    expect(unionCubes(base, [])).toEqual(base);
  });
});

describe('corpusInclusion', () => {
  it('computes a percent share per card name, sorted alphabetically', () => {
    const cubes = [
      { id: '1', names: new Set(['A', 'B']) },
      { id: '2', names: new Set(['A']) },
      { id: '3', names: new Set(['A', 'B']) },
      { id: '4', names: new Set(['C']) },
    ];
    const cards = corpusInclusion(cubes);
    expect(Object.keys(cards)).toEqual(['A', 'B', 'C']); // sorted
    expect(cards.A).toBe(75); // 3/4
    expect(cards.B).toBe(50); // 2/4
    expect(cards.C).toBe(25); // 1/4
  });

  it('never divides by zero on an empty corpus', () => {
    expect(corpusInclusion([])).toEqual({});
  });
});

describe('cardName', () => {
  it('prefers the Scryfall-joined details.name (mirrors mine-cube-targets.mjs)', () => {
    expect(cardName({ details: { name: 'Lightning Bolt' }, name: 'stale' })).toBe('Lightning Bolt');
  });

  it('falls back to the top-level name, then empty string', () => {
    expect(cardName({ name: 'Rancor' })).toBe('Rancor');
    expect(cardName({})).toBe('');
  });
});
