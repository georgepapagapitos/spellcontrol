import { describe, it, expect } from 'vitest';
import { liftDeckFloor, LIFT_STRICT_FLOOR, parseCardLiftPool, parseCardRelations } from './client';

// Minimal hand-written card-page shape — no network involved.
interface RawView {
  name?: string;
  lift?: number;
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
}
function page(cardlists: Array<{ tag: string; cardviews: RawView[] }>) {
  return { container: { json_dict: { cardlists } } };
}

describe('liftDeckFloor', () => {
  it('is 50 for a widely-played card and adapts down for a niche one', () => {
    expect(liftDeckFloor(100000)).toBe(50); // capped at 50
    expect(liftDeckFloor(600)).toBe(12); // 2% of 600 = 12, above the 12 floor
    expect(liftDeckFloor(100)).toBe(12); // 2% of 100 = 2, clamped up to 12
  });
});

describe('parseCardLiftPool', () => {
  it('returns [] for a missing/malformed container', () => {
    expect(parseCardLiftPool({})).toEqual([]);
    expect(parseCardLiftPool({ container: {} })).toEqual([]);
    expect(parseCardLiftPool({ container: { json_dict: {} } })).toEqual([]);
  });

  it('pulls from highliftcards and topcards, skipping meta lists', () => {
    const raw = page([
      {
        tag: 'topcommanders',
        cardviews: [{ name: 'Some Commander', lift: 99, num_decks: 9999, potential_decks: 10000 }],
      },
      {
        tag: 'highliftcards',
        cardviews: [
          { name: 'Smothering Tithe', lift: 8.2, num_decks: 4000, potential_decks: 10000 },
        ],
      },
      {
        tag: 'topcards',
        cardviews: [{ name: 'Sol Ring', lift: 1.5, num_decks: 9000, potential_decks: 10000 }],
      },
      {
        tag: 'newcards',
        cardviews: [{ name: 'New Card', lift: 3, num_decks: 500, potential_decks: 10000 }],
      },
      {
        tag: 'newcommanders',
        cardviews: [{ name: 'New Commander', lift: 3, num_decks: 500, potential_decks: 10000 }],
      },
    ]);
    const pool = parseCardLiftPool(raw);
    expect(pool.map((e) => e.name)).toEqual(['Smothering Tithe', 'Sol Ring']);
  });

  it('derives coPlayPct from inclusion/potential_decks, incl. potential_decks 0', () => {
    const raw = page([
      {
        tag: 'topcards',
        cardviews: [
          { name: 'Rhystic Study', lift: 4, inclusion: 5000, potential_decks: 10000 },
          { name: 'Zero Potential', lift: 4, inclusion: 20, potential_decks: 0 },
        ],
      },
    ]);
    const pool = parseCardLiftPool(raw);
    const rhystic = pool.find((e) => e.name === 'Rhystic Study');
    expect(rhystic?.coPlayPct).toBe(50);
    // potential_decks: 0 -> inclusion (20) doesn't clear the adaptive floor
    // (liftDeckFloor(0) = 12, so it *would* clear on numDecks alone), but
    // coPlayPct must still come out 0 rather than NaN/Infinity.
    const zero = pool.find((e) => e.name === 'Zero Potential');
    expect(zero?.coPlayPct).toBe(0);
  });

  it('drops a tiny-sample fluke under the adaptive floor but keeps a niche low-sample entry', () => {
    const raw = page([
      {
        tag: 'highliftcards',
        cardviews: [
          // floor(100000) = 50; num_decks 5 < 50 -> dropped
          { name: 'Fluke Card', lift: 400, num_decks: 5, potential_decks: 100000 },
          // floor(600) = 12; num_decks 15 >= 12 -> kept, but < strict floor 50 -> lowSample
          { name: 'Niche Card', lift: 6, num_decks: 15, potential_decks: 600 },
        ],
      },
    ]);
    const pool = parseCardLiftPool(raw);
    expect(pool.map((e) => e.name)).toEqual(['Niche Card']);
    expect(pool[0].lowSample).toBe(true);
    expect(pool[0].numDecks).toBeLessThan(LIFT_STRICT_FLOOR);
  });

  it('dedups by name keeping the max-lift occurrence', () => {
    const raw = page([
      {
        tag: 'highliftcards',
        cardviews: [
          { name: 'Dockside Extortionist', lift: 3, num_decks: 2000, potential_decks: 10000 },
        ],
      },
      {
        tag: 'topcards',
        cardviews: [
          { name: 'Dockside Extortionist', lift: 9, num_decks: 2000, potential_decks: 10000 },
        ],
      },
    ]);
    const pool = parseCardLiftPool(raw);
    expect(pool).toHaveLength(1);
    expect(pool[0].lift).toBe(9);
  });

  it('drops entries with no name or non-positive lift', () => {
    const raw = page([
      {
        tag: 'topcards',
        cardviews: [
          { lift: 5, num_decks: 2000, potential_decks: 10000 },
          { name: 'No Lift', lift: 0, num_decks: 2000, potential_decks: 10000 },
        ],
      },
    ]);
    expect(parseCardLiftPool(raw)).toEqual([]);
  });
});

describe('parseCardRelations', () => {
  it('keeps highliftcards and topcards as separate, order-preserving lists', () => {
    const raw = page([
      {
        tag: 'highliftcards',
        cardviews: [
          { name: 'B Card', lift: 5, num_decks: 3000, potential_decks: 10000 },
          { name: 'A Card', lift: 9, num_decks: 3000, potential_decks: 10000 },
        ],
      },
      {
        tag: 'topcards',
        cardviews: [{ name: 'Sol Ring', lift: 1.2, num_decks: 9000, potential_decks: 10000 }],
      },
    ]);
    const { highLift, topCards } = parseCardRelations(raw);
    // Order preserved as given (B before A), not re-sorted by lift.
    expect(highLift.map((e) => e.name)).toEqual(['B Card', 'A Card']);
    expect(topCards.map((e) => e.name)).toEqual(['Sol Ring']);
  });

  it('returns empty lists for a malformed container', () => {
    expect(parseCardRelations({})).toEqual({ highLift: [], topCards: [] });
  });
});
