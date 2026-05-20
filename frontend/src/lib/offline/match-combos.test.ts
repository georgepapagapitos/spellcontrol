import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { matchCombosLocal } from './match-combos';
import { clearOfflineData, replaceCombos } from './db';
import type { OfflineCombo } from './types';

function combo(
  id: string,
  cardIds: string[],
  opts: { popularity?: number; legalities?: Record<string, string> } = {}
): OfflineCombo {
  return {
    id,
    identity: 'WU',
    produces: ['mana'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: opts.popularity ?? 0,
    legalities: opts.legalities ?? { commander: 'legal' },
    cardCount: cardIds.length,
    bracket: null,
    cards: cardIds.map((oracleId, i) => ({
      oracleId,
      cardName: `Card-${oracleId}`,
      quantity: 1,
      position: i,
    })),
  };
}

describe('matchCombosLocal', () => {
  beforeEach(async () => {
    await clearOfflineData();
  });

  afterEach(async () => {
    await clearOfflineData();
  });

  it('buckets a fully-present deck combo into inDeck', async () => {
    await replaceCombos([combo('c1', ['a', 'b'])]);
    const res = await matchCombosLocal({
      ownedOracleIds: ['a', 'b', 'c'],
      deckOracleIds: ['a', 'b'],
    });
    expect(res.inDeck).toHaveLength(1);
    expect(res.oneAway).toHaveLength(0);
    expect(res.almostInCollection).toHaveLength(0);
  });

  it('puts a one-card-missing combo into oneAway when a deck is provided', async () => {
    await replaceCombos([combo('c1', ['a', 'b', 'c'])]);
    const res = await matchCombosLocal({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a', 'b'],
    });
    expect(res.inDeck).toHaveLength(0);
    expect(res.oneAway).toHaveLength(1);
    expect(res.oneAway[0].missingOracleIds).toEqual(['c']);
  });

  it('drops a combo if two or more cards are missing from the deck', async () => {
    await replaceCombos([combo('c1', ['a', 'b', 'c'])]);
    const res = await matchCombosLocal({
      ownedOracleIds: ['a'],
      deckOracleIds: ['a'],
    });
    expect(res.inDeck).toHaveLength(0);
    expect(res.oneAway).toHaveLength(0);
  });

  it('uses almostInCollection bucket when no deck is provided', async () => {
    await replaceCombos([combo('c1', ['a', 'b', 'c'])]);
    const res = await matchCombosLocal({ ownedOracleIds: ['a', 'b'] });
    expect(res.almostInCollection).toHaveLength(1);
  });

  it('filters by format legality', async () => {
    await replaceCombos([
      combo('legal-combo', ['a', 'b']),
      combo('banned-combo', ['a', 'b'], { legalities: { commander: 'banned' } }),
    ]);
    const res = await matchCombosLocal({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a', 'b'],
      format: 'commander',
    });
    expect(res.inDeck.map((m) => m.combo.id)).toEqual(['legal-combo']);
  });

  it('sorts buckets by popularity descending', async () => {
    await replaceCombos([
      combo('low', ['a', 'b'], { popularity: 1 }),
      combo('high', ['a', 'b'], { popularity: 999 }),
      combo('mid', ['a', 'b'], { popularity: 50 }),
    ]);
    const res = await matchCombosLocal({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a', 'b'],
    });
    expect(res.inDeck.map((m) => m.combo.id)).toEqual(['high', 'mid', 'low']);
  });

  it('skips empty combos defensively', async () => {
    await replaceCombos([{ ...combo('empty', []), cards: [] }, combo('real', ['a'])]);
    const res = await matchCombosLocal({ ownedOracleIds: ['a'], deckOracleIds: ['a'] });
    expect(res.inDeck.map((m) => m.combo.id)).toEqual(['real']);
  });
});
