import { describe, it, expect } from 'vitest';
import { isPoolTooThin, MIN_HEALTHY_POOL_DECKS, MIN_HEALTHY_POOL_CARDS } from './client';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';

// E93: isPoolTooThin gates the fallback ladder — these fixtures are the exact
// shapes seen live for "Mr. House, President and CEO" + Die Roll theme.
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

describe('isPoolTooThin', () => {
  it('flags a 0-deck, 0-card page as thin (Mr. House bracket-5 + Die Roll)', () => {
    expect(isPoolTooThin(pool(0, 0))).toBe(true);
  });

  it('flags a 19-deck cEDH-only page as thin even with a populated cardlist', () => {
    expect(isPoolTooThin(pool(19, 50))).toBe(true);
  });

  it('flags a page with plenty of decks but almost no distinct cards as thin', () => {
    expect(isPoolTooThin(pool(1000, 3))).toBe(true);
  });

  it('treats a healthy theme page (768 decks / 267 cards) as not thin', () => {
    expect(isPoolTooThin(pool(768, 267))).toBe(false);
  });

  it('sits right at the boundary', () => {
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS - 1, MIN_HEALTHY_POOL_CARDS))).toBe(true);
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS, MIN_HEALTHY_POOL_CARDS - 1))).toBe(true);
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS, MIN_HEALTHY_POOL_CARDS))).toBe(false);
  });
});
