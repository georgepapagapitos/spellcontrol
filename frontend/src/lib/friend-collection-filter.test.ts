import { describe, expect, it } from 'vitest';
import {
  filterFriendCollection,
  friendCardToPublic,
  sortFriendCollection,
} from './friend-collection-filter';
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
    const { cards: result } = filterFriendCollection(cards, { query: 'bolt', colors: new Set() });
    expect(result.map((c) => c.name)).toEqual(['Lightning Bolt']);
  });

  it('trims whitespace and empty query returns everything', () => {
    const { cards: result } = filterFriendCollection(cards, { query: '  ', colors: new Set() });
    expect(result).toHaveLength(4);
  });

  it('filters by any-selected-color match', () => {
    const { cards: result } = filterFriendCollection(cards, { query: '', colors: new Set(['W']) });
    expect(result.map((c) => c.name).sort()).toEqual(['Naya Charm', 'Wrath of God']);
  });

  it("'all' mode requires every selected color", () => {
    const { cards: result } = filterFriendCollection(cards, {
      query: '',
      colors: new Set(['R', 'W']),
      colorMode: 'all',
    });
    expect(result.map((c) => c.name)).toEqual(['Naya Charm']);
  });

  it('treats an empty colors array as colorless, matched by C', () => {
    const { cards: result } = filterFriendCollection(cards, { query: '', colors: new Set(['C']) });
    expect(result.map((c) => c.name)).toEqual(['Sol Ring']);
  });

  it('combines name and color filters', () => {
    const { cards: result } = filterFriendCollection(cards, {
      query: 'naya',
      colors: new Set(['G']),
    });
    expect(result.map((c) => c.name)).toEqual(['Naya Charm']);
  });

  it('sorts by edhrecRank ascending with undefined ranks last, then by name', () => {
    const { cards: result } = filterFriendCollection(cards, { query: '', colors: new Set() });
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

  // E237 — operator syntax now routes through the shared Scryfall engine.
  it('supports operator syntax alongside the colour chips', () => {
    const { cards: result } = filterFriendCollection(cards, {
      query: 't:creature',
      colors: new Set(),
    });
    expect(result).toHaveLength(4); // every fixture is typeLine 'Creature'
    const none = filterFriendCollection(cards, { query: 't:instant', colors: new Set() });
    expect(none.cards).toHaveLength(0);
  });

  it('reports clauses the friend payload cannot answer instead of zeroing silently', () => {
    const { cards: result, ignored } = filterFriendCollection(cards, {
      query: 'o:destroy',
      colors: new Set(),
    });
    expect(ignored).toEqual(['o:']);
    // Nothing matches, but `ignored` is what the UI shows so the empty list
    // never reads as "they own none of these".
    expect(result).toHaveLength(0);
  });

  it('keeps the answerable half of a mixed query, and still applies colour chips', () => {
    const { cards: result, ignored } = filterFriendCollection(cards, {
      query: 't:creature o:destroy',
      colors: new Set(['W']),
    });
    expect(ignored).toEqual(['o:']);
    expect(result.map((c) => c.name).sort()).toEqual(['Naya Charm', 'Wrath of God']);
  });

  it('reports nothing for a fully answerable query', () => {
    expect(filterFriendCollection(cards, { query: 'bolt', colors: new Set() }).ignored).toEqual([]);
  });
});

describe('friendCardToPublic', () => {
  it('carries the card facts across and leaves every printing field empty', () => {
    const pc = friendCardToPublic({
      name: 'Sol Ring',
      oracleId: 'sol',
      colors: [],
      colorIdentity: [],
      cmc: 1,
      typeLine: 'Artifact',
      rarity: 'uncommon',
      oracleText: '{T}: Add {C}{C}.',
      legalities: { commander: 'legal' },
    });
    expect(pc).toMatchObject({
      name: 'Sol Ring',
      oracleId: 'sol',
      cmc: 1,
      typeLine: 'Artifact',
      colors: [],
      colorIdentity: [],
      rarity: 'uncommon',
      oracleText: '{T}: Add {C}{C}.',
      legalities: { commander: 'legal' },
      setCode: '',
      purchasePrice: 0,
    });
  });
});

describe('sortFriendCollection', () => {
  const sol = card({ name: 'Sol Ring', edhrecRank: 1, cmc: 1, rarity: 'uncommon' });
  const bolt = card({ name: 'Lightning Bolt', edhrecRank: 50, cmc: 1, rarity: 'common' });
  const wrath = card({ name: 'Wrath of God', edhrecRank: 20, cmc: 4, rarity: 'rare' });
  const naya = card({ name: 'Naya Charm', cmc: 3, rarity: 'uncommon' });
  const cards = [naya, bolt, wrath, sol];

  it('popularity ascending is most-played first, unranked last either way', () => {
    expect(sortFriendCollection(cards, 'popularity', 'asc').map((c) => c.name)).toEqual([
      'Sol Ring',
      'Wrath of God',
      'Lightning Bolt',
      'Naya Charm',
    ]);
    expect(sortFriendCollection(cards, 'popularity', 'desc').map((c) => c.name)).toEqual([
      'Lightning Bolt',
      'Wrath of God',
      'Sol Ring',
      'Naya Charm',
    ]);
  });

  it('breaks mana-value and rarity ties by name and honours direction', () => {
    expect(sortFriendCollection(cards, 'cmc', 'asc').map((c) => c.name)).toEqual([
      'Lightning Bolt',
      'Sol Ring',
      'Naya Charm',
      'Wrath of God',
    ]);
    expect(sortFriendCollection(cards, 'rarity', 'desc').map((c) => c.name)).toEqual([
      'Wrath of God',
      'Naya Charm',
      'Sol Ring',
      'Lightning Bolt',
    ]);
  });

  it('does not mutate its input', () => {
    const copy = [...cards];
    sortFriendCollection(cards, 'name', 'asc');
    expect(cards).toEqual(copy);
  });
});
