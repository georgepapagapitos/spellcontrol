import { describe, it, expect } from 'vitest';
import { matchCombos, type ComboInput } from './match';

type CardSeed = { oracleId: string; cardName: string; quantity?: number };
function combo(
  partial: Omit<Partial<ComboInput>, 'cards'> & { id: string; cards: CardSeed[] }
): ComboInput {
  return {
    identity: '',
    produces: ['Infinite mana'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 0,
    legalities: { commander: 'legal' },
    cardCount: partial.cards.length,
    bracket: null,
    ...partial,
    cards: partial.cards.map((c) => ({ ...c, quantity: c.quantity ?? 1 })),
  };
}

describe('matchCombos', () => {
  const thassa = { oracleId: 'oracle-thassa', cardName: "Thassa's Oracle" };
  const consult = { oracleId: 'oracle-consult', cardName: 'Demonic Consultation' };
  const labman = { oracleId: 'oracle-labman', cardName: 'Laboratory Maniac' };
  const dryad = { oracleId: 'oracle-dryad', cardName: 'Dryad Arbor' };
  void dryad;

  const oracleConsult = combo({
    id: 'thoracle-consult',
    cards: [thassa, consult],
    popularity: 5000,
  });
  const oracleLabman = combo({
    id: 'thoracle-labman',
    cards: [thassa, labman],
    popularity: 800,
  });
  const triple = combo({
    id: 'triple',
    cards: [thassa, consult, dryad],
    popularity: 100,
  });

  it('buckets combos with all cards in deck as inDeck', () => {
    const result = matchCombos({
      combos: [oracleConsult, oracleLabman],
      ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman'],
      deckOracleIds: ['oracle-thassa', 'oracle-consult'],
    });
    expect(result.inDeck.map((m) => m.combo.id)).toEqual(['thoracle-consult']);
    expect(result.inDeck[0].missingOracleIds).toEqual([]);
  });

  it('flags combos missing exactly one deck card as oneAway (owned)', () => {
    const result = matchCombos({
      combos: [oracleLabman],
      ownedOracleIds: ['oracle-thassa', 'oracle-labman'],
      deckOracleIds: ['oracle-thassa'],
    });
    expect(result.oneAway).toHaveLength(1);
    expect(result.oneAway[0].missingOracleIds).toEqual(['oracle-labman']);
  });

  it('flags combos missing exactly one deck card as oneAway (unowned)', () => {
    const result = matchCombos({
      combos: [oracleLabman],
      ownedOracleIds: ['oracle-thassa'],
      deckOracleIds: ['oracle-thassa'],
    });
    expect(result.oneAway).toHaveLength(1);
    expect(result.oneAway[0].missingOracleIds).toEqual(['oracle-labman']);
  });

  it('skips combos missing two or more cards from the deck', () => {
    const result = matchCombos({
      combos: [triple],
      ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-dryad'],
      deckOracleIds: ['oracle-thassa'],
    });
    expect(result.inDeck).toHaveLength(0);
    expect(result.oneAway).toHaveLength(0);
  });

  it('without a deck filter, buckets by collection: full = inDeck, one-missing = almostInCollection', () => {
    const result = matchCombos({
      combos: [oracleConsult, oracleLabman],
      ownedOracleIds: ['oracle-thassa', 'oracle-consult'],
    });
    expect(result.inDeck.map((m) => m.combo.id)).toEqual(['thoracle-consult']);
    expect(result.almostInCollection.map((m) => m.combo.id)).toEqual(['thoracle-labman']);
  });

  it('honors format legality when provided', () => {
    const modernOnly = combo({
      id: 'modern-only',
      cards: [thassa, consult],
      legalities: { commander: 'not_legal', modern: 'legal' },
    });
    const everywhere = combo({
      id: 'every',
      cards: [thassa, consult],
      legalities: { commander: 'legal', modern: 'legal' },
    });
    const result = matchCombos({
      combos: [modernOnly, everywhere],
      ownedOracleIds: ['oracle-thassa', 'oracle-consult'],
      deckOracleIds: ['oracle-thassa', 'oracle-consult'],
      format: 'commander',
    });
    expect(result.inDeck.map((m) => m.combo.id)).toEqual(['every']);
  });

  it('sorts results by popularity descending', () => {
    const result = matchCombos({
      combos: [oracleLabman, oracleConsult, triple],
      ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman', 'oracle-dryad'],
      deckOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman', 'oracle-dryad'],
    });
    expect(result.inDeck.map((m) => m.combo.popularity)).toEqual([5000, 800, 100]);
  });
});
