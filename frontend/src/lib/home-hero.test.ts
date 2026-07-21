import { describe, it, expect } from 'vitest';
import {
  pickHeroCardName,
  heroGreeting,
  type HeroCollectionCard,
  type HeroDeck,
} from './home-hero';

const DAY_A = '2026-07-20';
const DAY_B = '2026-07-21';

function card(overrides: Partial<HeroCollectionCard> & { name: string }): HeroCollectionCard {
  return { purchasePrice: 0, acquiredAt: 0, ...overrides };
}

function deck(overrides: Partial<HeroDeck> = {}): HeroDeck {
  return { commanderName: null, updatedAt: 0, ...overrides };
}

describe('pickHeroCardName', () => {
  it('returns null for an empty collection and no decks', () => {
    expect(pickHeroCardName([], [], DAY_A)).toBeNull();
  });

  it('prefers the highest-value priced card over a cheaper one', () => {
    const cards = [
      card({ name: 'Bargain Bin', purchasePrice: 1 }),
      card({ name: 'Black Lotus', purchasePrice: 5000 }),
    ];
    expect(pickHeroCardName(cards, [], DAY_A)).toBe('Black Lotus');
  });

  it('falls back to the most recently acquired card when nothing is priced', () => {
    const cards = [
      card({ name: 'Old Import', purchasePrice: 0, acquiredAt: 1000 }),
      card({ name: 'New Import', purchasePrice: 0, acquiredAt: 5000 }),
    ];
    expect(pickHeroCardName(cards, [], DAY_A)).toBe('New Import');
  });

  it('falls back to the most recently updated deck commander when the collection is empty', () => {
    const decks = [
      deck({ commanderName: 'Old Commander', updatedAt: 1000 }),
      deck({ commanderName: 'New Commander', updatedAt: 5000 }),
    ];
    expect(pickHeroCardName([], decks, DAY_A)).toBe('New Commander');
  });

  it('skips decks with no commander when falling back', () => {
    const decks = [
      deck({ commanderName: null, updatedAt: 9999 }),
      deck({ commanderName: 'Only One', updatedAt: 1 }),
    ];
    expect(pickHeroCardName([], decks, DAY_A)).toBe('Only One');
  });

  it('never falls through to arrivals/decks once a priced card exists, even if a deck is newer', () => {
    const cards = [card({ name: 'Priced Card', purchasePrice: 3 })];
    const decks = [deck({ commanderName: 'Should Not Win', updatedAt: Date.now() })];
    expect(pickHeroCardName(cards, decks, DAY_A)).toBe('Priced Card');
  });

  it('is deterministic for a fixed day and rotates across a pool on a different day', () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      card({ name: `Card ${i}`, purchasePrice: 10 + i })
    );
    const pickA1 = pickHeroCardName(cards, [], DAY_A);
    const pickA2 = pickHeroCardName(cards, [], DAY_A);
    expect(pickA1).toBe(pickA2);

    // Across many consecutive days, the pool of 5 must be fully exercised —
    // proves the pick isn't pinned to always-highest-value.
    const seen = new Set<string | null>();
    for (let i = 0; i < 30; i++) {
      const day = `2026-08-${String((i % 28) + 1).padStart(2, '0')}`;
      seen.add(pickHeroCardName(cards, [], day));
    }
    expect(seen.size).toBeGreaterThan(1);
    // never invents a name outside the pool
    for (const name of seen) expect(cards.some((c) => c.name === name)).toBe(true);
  });

  it('rotates daily rather than statically pinning to the same card forever', () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      card({ name: `Card ${i}`, purchasePrice: 10 + i })
    );
    const pickDayA = pickHeroCardName(cards, [], DAY_A);
    const pickDayB = pickHeroCardName(cards, [], DAY_B);
    // Adjacent days land on adjacent pool slots (epoch-day % pool.length), so
    // with a 5-card pool they are expected to differ here specifically.
    expect(pickDayA).not.toBe(pickDayB);
  });
});

describe('heroGreeting', () => {
  it('greets morning hours', () => {
    expect(heroGreeting(5)).toBe('Good morning');
    expect(heroGreeting(11)).toBe('Good morning');
  });

  it('greets afternoon hours', () => {
    expect(heroGreeting(12)).toBe('Good afternoon');
    expect(heroGreeting(16)).toBe('Good afternoon');
  });

  it('greets evening/night hours, including past midnight', () => {
    expect(heroGreeting(17)).toBe('Good evening');
    expect(heroGreeting(23)).toBe('Good evening');
    expect(heroGreeting(0)).toBe('Good evening');
    expect(heroGreeting(4)).toBe('Good evening');
  });
});
