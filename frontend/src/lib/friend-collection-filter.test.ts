import { describe, expect, it } from 'vitest';
import { filterFriendCollection } from './friend-collection-filter';
import type { FriendCard } from './cube/pool';

function card(overrides: Partial<FriendCard> & { name: string }): FriendCard {
  return {
    oracleId: overrides.name,
    colors: [],
    cmc: 0,
    typeLine: 'Creature',
    ...overrides,
  };
}

describe('filterFriendCollection', () => {
  const sol = card({ name: 'Sol Ring', colors: [], edhrecRank: 1 });
  const bolt = card({ name: 'Lightning Bolt', colors: ['R'], edhrecRank: 50 });
  const wrath = card({ name: 'Wrath of God', colors: ['W'], edhrecRank: 20 });
  const naya = card({ name: 'Naya Charm', colors: ['R', 'G', 'W'] });
  const cards = [sol, bolt, wrath, naya];

  it('matches names case-insensitively as a substring', () => {
    const result = filterFriendCollection(cards, { query: 'bolt', colors: new Set() });
    expect(result.map((c) => c.name)).toEqual(['Lightning Bolt']);
  });

  it('trims whitespace and empty query returns everything', () => {
    const result = filterFriendCollection(cards, { query: '  ', colors: new Set() });
    expect(result).toHaveLength(4);
  });

  it('filters by any-selected-color match', () => {
    const result = filterFriendCollection(cards, { query: '', colors: new Set(['W']) });
    expect(result.map((c) => c.name).sort()).toEqual(['Naya Charm', 'Wrath of God']);
  });

  it('treats an empty colors array as colorless, matched by C', () => {
    const result = filterFriendCollection(cards, { query: '', colors: new Set(['C']) });
    expect(result.map((c) => c.name)).toEqual(['Sol Ring']);
  });

  it('combines name and color filters', () => {
    const result = filterFriendCollection(cards, { query: 'naya', colors: new Set(['G']) });
    expect(result.map((c) => c.name)).toEqual(['Naya Charm']);
  });

  it('sorts by edhrecRank ascending with undefined ranks last, then by name', () => {
    const result = filterFriendCollection(cards, { query: '', colors: new Set() });
    // sol(1), wrath(20), bolt(50), naya(undefined)
    expect(result.map((c) => c.name)).toEqual([
      'Sol Ring',
      'Wrath of God',
      'Lightning Bolt',
      'Naya Charm',
    ]);
  });

  it('never mutates the input array', () => {
    const copy = [...cards];
    filterFriendCollection(cards, { query: '', colors: new Set() });
    expect(cards).toEqual(copy);
  });
});
