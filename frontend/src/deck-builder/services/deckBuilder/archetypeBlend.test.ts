import { describe, it, expect } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';
import {
  BLEND_N_MAX,
  BLEND_N_MIN,
  BLEND_WEIGHT_MAX,
  BLEND_WEIGHT_MIN,
  MAX_INJECTED_PER_CATEGORY,
  blendTagPageIntoPool,
  blendWeight,
  resolveArchetypeBlend,
  summarizeSeatedBlend,
} from './archetypeBlend';

function card(name: string, inclusion: number, numDecks = 10_000): EDHRECCard {
  return {
    name,
    sanitized: name.toLowerCase().replace(/\s+/g, '-'),
    primary_type: 'Creature',
    inclusion,
    num_decks: numDecks,
  };
}

function emptyLists(): EDHRECCommanderData['cardlists'] {
  return {
    creatures: [],
    instants: [],
    sorceries: [],
    artifacts: [],
    enchantments: [],
    planeswalkers: [],
    lands: [],
    allNonLand: [],
  };
}

function lists(
  partial: Partial<EDHRECCommanderData['cardlists']>
): EDHRECCommanderData['cardlists'] {
  const base = emptyLists();
  const merged = { ...base, ...partial };
  // Mirror parseCardlists' invariant: every non-land card is also in allNonLand.
  if (!partial.allNonLand) {
    merged.allNonLand = [
      ...merged.creatures,
      ...merged.instants,
      ...merged.sorceries,
      ...merged.artifacts,
      ...merged.enchantments,
      ...merged.planeswalkers,
    ];
  }
  return merged;
}

describe('resolveArchetypeBlend', () => {
  it('is OFF unless explicitly enabled — no smart default before the gate clears', () => {
    expect(resolveArchetypeBlend({ archetypeBlend: undefined })).toBe(false);
    expect(resolveArchetypeBlend({})).toBe(false);
    expect(resolveArchetypeBlend({ archetypeBlend: false })).toBe(false);
    expect(resolveArchetypeBlend({ archetypeBlend: true })).toBe(true);
  });
});

describe('blendWeight', () => {
  it('leans hard on the tag page when the commander has almost no decks', () => {
    expect(blendWeight(BLEND_N_MIN)).toBeCloseTo(BLEND_WEIGHT_MAX, 10);
    expect(blendWeight(12)).toBeCloseTo(BLEND_WEIGHT_MAX, 10); // clamped below the floor
    expect(blendWeight(0)).toBeCloseTo(BLEND_WEIGHT_MAX, 10);
  });

  it('flattens to a light nudge once the commander page is well populated', () => {
    expect(blendWeight(BLEND_N_MAX)).toBeCloseTo(BLEND_WEIGHT_MIN, 10);
    expect(blendWeight(40_000)).toBeCloseTo(BLEND_WEIGHT_MIN, 10); // clamped above the ceiling
  });

  it('interpolates on a log scale between the two, monotonically decreasing', () => {
    // Geometric midpoint of [50, 500] → exactly halfway between the weights.
    const mid = Math.sqrt(BLEND_N_MIN * BLEND_N_MAX);
    expect(blendWeight(mid)).toBeCloseTo((BLEND_WEIGHT_MAX + BLEND_WEIGHT_MIN) / 2, 10);
    const samples = [50, 100, 200, 300, 400, 500].map(blendWeight);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });
});

describe('blendTagPageIntoPool', () => {
  it('injects only cards the commander pool is missing, discounted by the weight', () => {
    const pool = lists({ creatures: [card('Blood Artist', 60)] });
    const tagPage = lists({
      creatures: [card('Blood Artist', 80), card('Zulaport Cutthroat', 40)],
    });

    const result = blendTagPageIntoPool({
      pool,
      tagPageCardlists: tagPage,
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: BLEND_N_MIN, // weight 0.9
    });

    expect(result.injectedNames).toEqual(['Zulaport Cutthroat']);
    const injected = result.cardlists.creatures.find((c) => c.name === 'Zulaport Cutthroat')!;
    expect(injected.inclusion).toBeCloseTo(40 * BLEND_WEIGHT_MAX, 10);
    expect(injected.blendSource).toBe('archetype-blend');
    // The card the pool already had keeps the commander page's own number.
    expect(result.cardlists.creatures.find((c) => c.name === 'Blood Artist')!.inclusion).toBe(60);
  });

  it('maintains the allNonLand union, and keeps lands out of it', () => {
    const result = blendTagPageIntoPool({
      pool: emptyLists(),
      tagPageCardlists: lists({
        creatures: [card('Blood Artist', 50)],
        lands: [card('Phyrexian Tower', 30)],
      }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });

    expect(result.cardlists.allNonLand.map((c) => c.name)).toEqual(['Blood Artist']);
    expect(result.cardlists.lands.map((c) => c.name)).toEqual(['Phyrexian Tower']);
  });

  it('caps injections per category and keeps the most-played ones', () => {
    const many = Array.from({ length: MAX_INJECTED_PER_CATEGORY + 10 }, (_, i) =>
      card(`Card ${i}`, i + 1)
    );
    const result = blendTagPageIntoPool({
      pool: emptyLists(),
      tagPageCardlists: lists({ creatures: many }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });

    expect(result.injectedNames).toHaveLength(MAX_INJECTED_PER_CATEGORY);
    // Highest inclusion wins: Card 24 (incl 25) down to Card 10 (incl 11).
    expect(result.injectedNames).toContain('Card 24');
    expect(result.injectedNames).not.toContain('Card 0');
  });

  it('drops tag-page cards below the shared lift deck floor rather than inventing a second threshold', () => {
    // liftDeckFloor(10_000) === 50 (the flat ceiling), so 49 decks is noise.
    const result = blendTagPageIntoPool({
      pool: emptyLists(),
      tagPageCardlists: lists({
        creatures: [card('Too Rare', 90, 49), card('Common Enough', 10, 50)],
      }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });
    expect(result.injectedNames).toEqual(['Common Enough']);
  });

  it('scales that floor down for a small tag page, so niche themes still blend', () => {
    // liftDeckFloor(600) === max(12, 12) === 12.
    const result = blendTagPageIntoPool({
      pool: emptyLists(),
      tagPageCardlists: lists({ creatures: [card('Niche Pick', 30, 12)] }),
      tagPagePotentialDecks: 600,
      commanderNumDecks: 40,
    });
    expect(result.injectedNames).toEqual(['Niche Pick']);
  });

  it('never injects the same card twice when the tag page lists it under two buckets', () => {
    const dupe = card('Deadly Dispute', 45);
    const result = blendTagPageIntoPool({
      pool: emptyLists(),
      tagPageCardlists: lists({ instants: [dupe], sorceries: [{ ...dupe }] }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });
    expect(result.injectedNames).toEqual(['Deadly Dispute']);
    expect(result.cardlists.allNonLand.filter((c) => c.name === 'Deadly Dispute')).toHaveLength(1);
  });

  it('matches existing pool entries case-insensitively', () => {
    const result = blendTagPageIntoPool({
      pool: lists({ creatures: [card('blood artist', 60)] }),
      tagPageCardlists: lists({ creatures: [card('Blood Artist', 80)] }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });
    expect(result.injectedNames).toEqual([]);
  });

  it('leaves the caller’s pool untouched and returns every bucket inclusion-sorted', () => {
    const pool = lists({ creatures: [card('Blood Artist', 20)] });
    const result = blendTagPageIntoPool({
      pool,
      tagPageCardlists: lists({ creatures: [card('Zulaport Cutthroat', 90)] }),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: BLEND_N_MAX, // weight 0.35 → 31.5, still above 20
    });

    expect(pool.creatures).toHaveLength(1); // not mutated
    expect(result.cardlists.creatures.map((c) => c.name)).toEqual([
      'Zulaport Cutthroat',
      'Blood Artist',
    ]);
  });

  it('is a no-op when the tag page adds nothing', () => {
    const result = blendTagPageIntoPool({
      pool: lists({ creatures: [card('Blood Artist', 60)] }),
      tagPageCardlists: emptyLists(),
      tagPagePotentialDecks: 10_000,
      commanderNumDecks: 100,
    });
    expect(result.injectedNames).toEqual([]);
  });
});

// The blend injects up to 15/category into the POOL (~90 for a thin commander)
// but only a handful survive into the final 99. A live niche run disclosed
// "Added 93 cards" for a deck that seated far fewer — the pool count is simply
// the wrong number to show a user, and the wrong set to exempt from misfits.
describe('summarizeSeatedBlend', () => {
  const deck = [{ name: 'Blood Artist' }, { name: 'Sol Ring' }, { name: 'Command Tower' }];

  it('counts only the injected cards that actually shipped', () => {
    const { names, note } = summarizeSeatedBlend(
      ['Blood Artist', 'Zulaport Cutthroat', 'Deadly Dispute'],
      deck,
      'Aristocrats',
      42
    );
    expect(names).toEqual(['Blood Artist']);
    expect(note).toBe(
      '1 card in this deck came from the Aristocrats archetype page — this commander has only 42 decks on record, so the theme page filled the gaps.'
    );
  });

  it('pluralizes both the card count and the deck sample', () => {
    const { note } = summarizeSeatedBlend(['Blood Artist', 'Sol Ring'], deck, 'Tokens', 1);
    expect(note).toContain('2 cards in this deck');
    expect(note).toContain('only 1 deck on record');
  });

  it('matches case-insensitively, like the pool dedup does', () => {
    const { names } = summarizeSeatedBlend(['blood artist'], deck, 'Aristocrats', 42);
    expect(names).toEqual(['blood artist']);
  });

  it('stays silent when nothing was injected, or nothing survived', () => {
    expect(summarizeSeatedBlend([], deck, 'Tokens', 42).note).toBeUndefined();
    expect(summarizeSeatedBlend(['Never Seated'], deck, 'Tokens', 42).note).toBeUndefined();
    expect(summarizeSeatedBlend(['Never Seated'], deck, 'Tokens', 42).names).toBeUndefined();
  });

  it('drops the sample clause rather than claiming "0 decks on record"', () => {
    const { note } = summarizeSeatedBlend(['Blood Artist'], deck, 'Aristocrats', 0);
    expect(note).toContain('came from the Aristocrats archetype page');
    expect(note).not.toContain('0 decks');
  });
});
