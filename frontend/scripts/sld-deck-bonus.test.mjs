import { describe, it, expect } from 'vitest';
import { deckBonusCards } from './sld-deck-bonus.mjs';

// Shapes copied from mtg-sealed-content data/products/SLD.yaml (2026-10-30).
const products = {
  'Secret Lair Commander Deck Odds and Ends': {
    category: 'DECK',
    contents: {
      card_count: 100,
      deck: [{ name: 'Odds and Ends', set: 'sld' }],
      other: [{ name: 'foil Perplexing Chimera (7039)' }],
    },
  },
  'Secret Lair Commander Deck Goblin Storm': {
    category: 'DECK',
    contents: {
      deck: [{ name: 'Goblin Storm', set: 'sld' }],
      card: [{ foil: true, name: 'Moggcatcher', number: 7081, set: 'sld' }],
      other: [{ name: '10 Double Faced Tokens' }, { name: 'Coin' }],
    },
  },
  'Secret Lair Commander Deck Heads I Win, Tails You Lose': {
    category: 'DECK',
    contents: {
      deck: [{ name: 'Heads I Win, Tails You Lose', set: 'sld' }],
      other: [{ name: 'Life Wheel' }],
    },
  },
  'Secret Lair Drop Some Drop': {
    category: 'BOX_SET',
    contents: { card: [{ name: 'X', number: 1, set: 'sld' }] },
  },
};

describe('deckBonusCards', () => {
  it("reads a deck's bonus from an `other` line and a `card` entry", () => {
    expect(deckBonusCards(products)).toEqual([
      { deck: 'Goblin Storm', cards: [{ name: 'Moggcatcher', number: '7081', foil: true }] },
      {
        deck: 'Odds and Ends',
        cards: [{ name: 'Perplexing Chimera', number: '7039', foil: true }],
      },
    ]);
  });

  it('skips non-card `other` lines, decks with no bonus, and products with no deck', () => {
    const decks = deckBonusCards(products).map((d) => d.deck);
    expect(decks).not.toContain('Heads I Win, Tails You Lose');
    expect(deckBonusCards({ a: products['Secret Lair Drop Some Drop'] })).toEqual([]);
  });

  it('ignores a plain drop that names a deck for its own cards', () => {
    const drop = {
      category: 'BOX_SET',
      contents: {
        deck: [{ name: 'A Box of Rocks' }],
        card: [{ name: 'X', number: 1, set: 'sld' }],
      },
    };
    expect(deckBonusCards({ drop })).toEqual([]);
  });

  it('keeps one entry per number when two editions name the same deck', () => {
    const twice = {
      a: {
        category: 'DECK',
        contents: { deck: [{ name: 'D' }], card: [{ name: 'C', number: 5, set: 'sld' }] },
      },
      b: { category: 'DECK', contents: { deck: [{ name: 'D' }], other: [{ name: 'C (5)' }] } },
    };
    expect(deckBonusCards(twice)).toEqual([
      { deck: 'D', cards: [{ name: 'C', number: '5', foil: false }] },
    ]);
  });
});
