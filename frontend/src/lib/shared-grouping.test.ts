import { describe, it, expect } from 'vitest';
import {
  deckBucketFor,
  filterByColors,
  filterBySearch,
  groupCards,
  sortGrouped,
} from './shared-grouping';
import type { PublicCard } from './shared-types';

function card(overrides: Partial<PublicCard> = {}): PublicCard {
  return {
    name: 'Sol Ring',
    scryfallId: 'sol-ring-id',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '472',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1.5,
    cmc: 1,
    ...overrides,
  };
}

describe('groupCards', () => {
  it('stacks duplicate printing+finish into a single group with a quantity', () => {
    const out = groupCards([card(), card(), card({ name: 'Sol Ring' })]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3);
    expect(out[0].card.name).toBe('Sol Ring');
  });

  it('treats different finishes as different groups', () => {
    const out = groupCards([card({ finish: 'nonfoil' }), card({ finish: 'foil', foil: true })]);
    expect(out).toHaveLength(2);
  });

  it('treats different printings as different groups', () => {
    const out = groupCards([
      card({ scryfallId: 'a', setCode: 'mh1' }),
      card({ scryfallId: 'b', setCode: 'mh2' }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('sortGrouped', () => {
  const grouped = groupCards([
    card({ name: 'Arcane Signet', cmc: 2, purchasePrice: 0.5, scryfallId: 'a' }),
    card({ name: 'Sol Ring', cmc: 1, purchasePrice: 1.5, scryfallId: 'b' }),
    card({ name: 'Mana Crypt', cmc: 0, purchasePrice: 120, scryfallId: 'c' }),
  ]);

  it('sorts by name asc', () => {
    const out = sortGrouped(grouped, 'name', 'asc');
    expect(out.map((g) => g.card.name)).toEqual(['Arcane Signet', 'Mana Crypt', 'Sol Ring']);
  });

  it('sorts by cmc asc', () => {
    const out = sortGrouped(grouped, 'cmc', 'asc');
    expect(out.map((g) => g.card.cmc)).toEqual([0, 1, 2]);
  });

  it('sorts by price desc', () => {
    const out = sortGrouped(grouped, 'price', 'desc');
    expect(out[0].card.name).toBe('Mana Crypt');
  });

  it('produces a deterministic order on ties', () => {
    const allEqual = groupCards([
      card({ name: 'A', cmc: 1, scryfallId: 'a' }),
      card({ name: 'B', cmc: 1, scryfallId: 'b' }),
    ]);
    const a = sortGrouped(allEqual, 'cmc', 'asc');
    const b = sortGrouped(allEqual, 'cmc', 'asc');
    expect(a.map((g) => g.card.name)).toEqual(b.map((g) => g.card.name));
  });
});

describe('filterBySearch', () => {
  const grouped = groupCards([
    card({ name: 'Sol Ring', scryfallId: 'sr' }),
    card({ name: 'Arcane Signet', scryfallId: 'as' }),
  ]);

  it('matches substring case-insensitively', () => {
    expect(filterBySearch(grouped, 'sol').map((g) => g.card.name)).toEqual(['Sol Ring']);
    expect(filterBySearch(grouped, 'SIGNET').map((g) => g.card.name)).toEqual(['Arcane Signet']);
  });

  it('returns all on empty query', () => {
    expect(filterBySearch(grouped, '')).toEqual(grouped);
    expect(filterBySearch(grouped, '   ')).toEqual(grouped);
  });
});

describe('filterByColors', () => {
  const grouped = groupCards([
    card({ name: 'Sol Ring', scryfallId: 'sr', colorIdentity: [] }),
    card({ name: 'Counterspell', scryfallId: 'cs', colorIdentity: ['U'] }),
    card({ name: 'Mortify', scryfallId: 'mort', colorIdentity: ['W', 'B'] }),
  ]);

  it('returns all when filter is empty', () => {
    expect(filterByColors(grouped, new Set())).toEqual(grouped);
  });

  it('matches by any color in identity', () => {
    expect(filterByColors(grouped, new Set(['U'])).map((g) => g.card.name)).toEqual([
      'Counterspell',
    ]);
    expect(filterByColors(grouped, new Set(['W'])).map((g) => g.card.name)).toEqual(['Mortify']);
  });

  it("treats 'C' as colorless (empty colorIdentity)", () => {
    expect(filterByColors(grouped, new Set(['C'])).map((g) => g.card.name)).toEqual(['Sol Ring']);
  });
});

describe('deckBucketFor', () => {
  it('returns the major type for known type lines', () => {
    expect(deckBucketFor('Creature — Goblin')).toBe('Creature');
    expect(deckBucketFor('Sorcery')).toBe('Sorcery');
    expect(deckBucketFor('Instant')).toBe('Instant');
    expect(deckBucketFor('Enchantment — Aura')).toBe('Enchantment');
    expect(deckBucketFor('Artifact')).toBe('Artifact');
    expect(deckBucketFor('Planeswalker — Teferi')).toBe('Planeswalker');
  });

  it('puts artifact lands in the Land bucket', () => {
    expect(deckBucketFor('Artifact Land')).toBe('Land');
  });

  it("falls back to 'Other' for unknown lines", () => {
    expect(deckBucketFor(undefined)).toBe('Other');
    expect(deckBucketFor('')).toBe('Other');
    expect(deckBucketFor('Tribal — Wizard')).toBe('Other');
  });
});
