import { describe, it, expect } from 'vitest';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';
import type { ScryfallCard } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: ['W', 'B'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('fitsColorIdentity', () => {
  it('passes when card identity is a subset of the commander identity', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: ['W'] }), ['W', 'B'])).toBe(true);
  });

  it('treats colorless (empty identity) as always fitting', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: [] }), ['G'])).toBe(true);
  });

  it('fails when the card has a color outside the commander identity', () => {
    expect(fitsColorIdentity(makeCard({ color_identity: ['W', 'R'] }), ['W', 'B'])).toBe(false);
  });
});

describe('exceedsMaxPrice', () => {
  it('returns false when no budget is set', () => {
    expect(exceedsMaxPrice(makeCard({ prices: { usd: '99.99' } }), null)).toBe(false);
  });

  it('treats missing price data as over-budget when a budget is active', () => {
    expect(exceedsMaxPrice(makeCard({ prices: {} }), 5)).toBe(true);
  });

  it('compares against the price for the requested currency', () => {
    const card = makeCard({ prices: { usd: '3.00', eur: '8.00' } });
    expect(exceedsMaxPrice(card, 5, 'USD')).toBe(false);
    expect(exceedsMaxPrice(card, 5, 'EUR')).toBe(true);
  });
});

describe('exceedsMaxRarity', () => {
  it('returns false when no rarity cap is set', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'mythic' }), null)).toBe(false);
  });

  it('allows cards at or below the cap and rejects above it', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'uncommon' }), 'rare')).toBe(false);
    expect(exceedsMaxRarity(makeCard({ rarity: 'rare' }), 'rare')).toBe(false);
    expect(exceedsMaxRarity(makeCard({ rarity: 'mythic' }), 'rare')).toBe(true);
  });

  it('treats unknown rarities as the highest tier', () => {
    expect(exceedsMaxRarity(makeCard({ rarity: 'special' }), 'rare')).toBe(true);
  });
});

describe('collection predicates', () => {
  it('treats full and available as hard collection constraints', () => {
    expect(constrainsToCollection('full')).toBe(true);
    expect(constrainsToCollection('available')).toBe(true);
    expect(constrainsToCollection('partial')).toBe(false);
    expect(constrainsToCollection('prefer')).toBe(false);
  });

  it('notInCollection is false when no collection is provided', () => {
    expect(notInCollection('Sol Ring', undefined)).toBe(false);
  });

  it('notInCollection reflects set membership', () => {
    const owned = new Set(['Sol Ring']);
    expect(notInCollection('Sol Ring', owned)).toBe(false);
    expect(notInCollection('Mana Crypt', owned)).toBe(true);
  });

  it('owned exemptions require both the flag and ownership', () => {
    const owned = new Set(['Sol Ring']);
    expect(isOwnedBudgetExempt('Sol Ring', owned, true)).toBe(true);
    expect(isOwnedBudgetExempt('Sol Ring', owned, false)).toBe(false);
    expect(isOwnedBudgetExempt('Mana Crypt', owned, true)).toBe(false);
    expect(isOwnedRarityExempt('Sol Ring', owned, true)).toBe(true);
    expect(isOwnedRarityExempt('Sol Ring', undefined, true)).toBe(false);
  });
});

describe('notOnArena', () => {
  it('returns false when arena-only mode is off', () => {
    expect(notOnArena(makeCard({ games: [] }), false)).toBe(false);
  });

  it('filters cards not available on Arena', () => {
    expect(notOnArena(makeCard({ games: ['paper'] }), true)).toBe(true);
    expect(notOnArena(makeCard({ games: ['paper', 'arena'] }), true)).toBe(false);
  });
});

describe('exceedsCmcCap', () => {
  it('returns false when no cap is set', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 9 }), null)).toBe(false);
  });

  it('never filters lands by CMC', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 9, type_line: 'Land' }), 3)).toBe(false);
  });

  it('filters non-land cards above the cap', () => {
    expect(exceedsCmcCap(makeCard({ cmc: 3 }), 3)).toBe(false);
    expect(exceedsCmcCap(makeCard({ cmc: 4 }), 3)).toBe(true);
  });
});
