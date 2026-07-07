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

  it('ladders theme+bracket -> theme -> base+bracket -> base, stopping at the first healthy rung', async () => {
    // Theme outranks bracket-only: the user picked this theme, so it's the
    // deck's identity, while bracket permissions survive independent of
    // which page supplies the pool (see the ladder comment in deckGenerator.ts).
    // Dropping to bracket-only before trying the theme without a bracket
    // would silently swap "the theme deck the user asked for" for a
    // goodstuff deck at the right power level — the failure this fix exists
    // to prevent (e.g. a popular commander + niche theme + high bracket,
    // where the bracket-only page is healthy but ignores the theme).
    const candidates = rungs(
      ['theme+bracket', 'theme', 'base+bracket', 'base'],
      [THEME_BRACKET_EMPTY, HEALTHY_THEME, BRACKET_ONLY_NOISY, HEALTHY_THEME]
    );
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('theme');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
    expect(candidates[2].fetch).not.toHaveBeenCalled(); // never reached 'base+bracket'
    expect(candidates[3].fetch).not.toHaveBeenCalled(); // never reached 'base'
  });

  it('treats a thrown fetch the same as a thin pool and moves to the next rung', async () => {
    const candidates = rungs(['theme+bracket', 'base+bracket'], [new Error('404'), HEALTHY_THEME]);
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('base+bracket');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
    // S1 ladder-cause-honesty: the first rung THREW — that's a fetch failure,
    // not a thin-but-parsed pool, and the two must stay distinguishable.
    expect(outcome?.fellBackCause).toBe('fetch-failed');
  });

  it('falls back to the broadest (last) rung when every candidate is thin', async () => {
    const candidates = rungs(
      ['theme+bracket', 'base+bracket', 'base'],
      [THEME_BRACKET_EMPTY, BRACKET_ONLY_NOISY, BRACKET_ONLY_NOISY]
    );
    const outcome = await fetchPoolWithFallback(candidates);
    expect(outcome?.source).toBe('base');
    expect(outcome?.fellBackFrom).toBe('theme+bracket');
    // The first rung resolved fine — it was just thin, never a fetch failure.
    expect(outcome?.fellBackCause).toBe('thin');
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

  // S1 ladder-cause-honesty: the note's existing sentence is pinned by the
  // three tests above with no `cause` argument at all — confirms the default
  // (omitted / 'thin') is byte-identical to the pre-S1 copy those tests pin.
  it('appends the fetch-failed cause distinction when the page never resolved', () => {
    const note = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'theme+bracket',
      'base+bracket',
      'Die Roll',
      'fetch-failed'
    );
    expect(note).toContain("(the page couldn't be fetched)");
  });

  it('adds no cause phrase for a genuinely thin page (matches the no-cause copy)', () => {
    const withCause = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'theme+bracket',
      'base+bracket',
      'Die Roll',
      'thin'
    );
    const withoutCause = buildBracketPoolFallbackNote(
      'Mr. House, President and CEO',
      5,
      'theme+bracket',
      'base+bracket',
      'Die Roll'
    );
    expect(withCause).toBe(withoutCause);
  });
});
