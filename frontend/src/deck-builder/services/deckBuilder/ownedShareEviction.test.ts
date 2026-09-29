import { describe, it, expect } from 'vitest';
import { pageInclusionOf, weakestFirst } from './ownedShareEviction';

// Real rows from Krenko, Mob Boss's EDHREC page (live HTTP cache, 2026-09-29):
// inclusion = num_decks / potential_decks. EDHREC keys the saga by its front
// face; the deck holds Scryfall's full double-faced name.
const KRENKO_PAGE = new Map([
  ['Fable of the Mirror-Breaker', (100 * 4687) / 44269], // 10.6%
  ['Shock', (100 * 3054) / 44269], // 6.9%
  ['Light Up the Stage', (100 * 2217) / 44269], // 5.0%
]);

describe('owned-share eviction order', () => {
  const inclusionOf = pageInclusionOf(KRENKO_PAGE);

  it("reads a double-faced card by its front face's page row", () => {
    expect(inclusionOf('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')).toBeCloseTo(
      10.59,
      1
    );
    expect(inclusionOf('Not On The Page')).toBe(-1);
  });

  it('evicts the least-played card first, not the double-faced one', () => {
    const deck = [
      { name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki' },
      { name: 'Shock' },
      { name: 'Light Up the Stage' },
    ];
    expect(weakestFirst(deck, inclusionOf).map((c) => c.name)).toEqual([
      'Light Up the Stage',
      'Shock',
      'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
    ]);
  });
});
