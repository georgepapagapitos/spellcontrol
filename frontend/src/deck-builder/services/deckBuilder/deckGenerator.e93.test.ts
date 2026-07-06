// E93: a bracket-narrowed EDHREC page (theme+bracket or bracket-only) can
// resolve to a statistically thin — or entirely empty — pool while still
// parsing as valid JSON, silently degrading generation to a Scryfall-only
// fallback. fetchPoolWithFallback ladders down to a broader page instead;
// these are pure-function tests against hand-fed fetchers (no network, no
// full generateDeck orchestration — that's covered by deckGenerator.golden.test.ts).
import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';
import {
  fetchPoolWithFallback,
  buildBracketPoolFallbackNote,
  type PoolRung,
} from './deckGenerator';

function card(name: string): EDHRECCard {
  return {
    name,
    sanitized: name.toLowerCase(),
    primary_type: 'Creature',
    inclusion: 10,
    num_decks: 10,
  };
}

function pool(numDecks: number, nonLandCount: number): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: Array.from({ length: nonLandCount }, (_, i) => card(`Card ${i}`)),
    },
    similarCommanders: [],
  };
}

// Live-measured Mr. House + Die Roll shapes (E93 report).
const THEME_BRACKET_EMPTY = pool(0, 0); // .../cedh/die-roll.json
const BRACKET_ONLY_NOISY = pool(19, 50); // .../cedh.json
const HEALTHY_THEME = pool(768, 267); // .../die-roll.json

function rungs(
  sources: PoolRung[],
  results: Array<EDHRECCommanderData | Error>
): { source: PoolRung; fetch: () => Promise<EDHRECCommanderData> }[] {
  return sources.map((source, i) => ({
    source,
    fetch: vi.fn(async () => {
      const r = results[i];
      if (r instanceof Error) throw r;
      return r;
    }),
  }));
}

describe('fetchPoolWithFallback', () => {
  it('stops at the first healthy rung without trying the rest', async () => {
    const candidates = rungs(['theme+bracket', 'base+bracket'], [HEALTHY_THEME, HEALTHY_THEME]);
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('theme+bracket');
    expect(outcome?.fellBackFrom).toBeUndefined();
    expect(candidates[1].fetch).not.toHaveBeenCalled();
  });

  it('ladders theme+bracket -> base+bracket -> theme -> base, stopping at the first healthy rung', async () => {
    const candidates = rungs(
      ['theme+bracket', 'base+bracket', 'theme', 'base'],
      [THEME_BRACKET_EMPTY, BRACKET_ONLY_NOISY, HEALTHY_THEME, HEALTHY_THEME]
    );
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('theme');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
    expect(candidates[3].fetch).not.toHaveBeenCalled(); // never reached 'base'
  });

  it('treats a thrown fetch the same as a thin pool and moves to the next rung', async () => {
    const candidates = rungs(['theme+bracket', 'base+bracket'], [new Error('404'), HEALTHY_THEME]);
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('base+bracket');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
  });

  it('falls back to the broadest (last) rung when every candidate is thin', async () => {
    const candidates = rungs(
      ['theme+bracket', 'base+bracket', 'base'],
      [THEME_BRACKET_EMPTY, BRACKET_ONLY_NOISY, BRACKET_ONLY_NOISY]
    );
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('base');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
  });

  it('returns null only when every rung throws', async () => {
    const candidates = rungs(
      ['theme+bracket', 'base'],
      [new Error('network'), new Error('network')]
    );
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome).toBeNull();
  });
});

describe('buildBracketPoolFallbackNote', () => {
  it('names the missing page, the used page, and confirms bracket permissions kept (theme dropped)', () => {
    const note = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'theme+bracket',
      'base+bracket',
      'Die Roll'
    );
    expect(note).toContain('Mr. House, President and CEO + Die Roll');
    expect(note).toContain('bracket-5 (cEDH)');
    expect(note).toMatch(/built from .*bracket-5 \(cEDH\).* instead/);
    expect(note).toContain('card permissions kept');
  });

  it('names the theme page when bracket is dropped but the theme is kept', () => {
    const note = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'theme+bracket',
      'theme',
      'Die Roll'
    );
    expect(note).toContain('built from the main Die Roll page instead');
    expect(note).toContain('bracket-5 (cEDH) card permissions kept');
  });

  it('has no theme phrase when no theme was selected', () => {
    const note = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'base+bracket',
      'base',
      undefined
    );
    expect(note).not.toContain('+ undefined');
    expect(note).toContain('built from the main commander page instead');
  });
});
