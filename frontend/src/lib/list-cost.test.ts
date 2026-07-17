import { describe, it, expect } from 'vitest';
import type { EnrichedCard, ListEntry } from '../types';
import { summarizeListCost } from './list-cost';

function entry(over: Partial<ListEntry> = {}): ListEntry {
  return {
    id: 'e' + Math.random(),
    name: 'Sol Ring',
    scryfallId: 'sf-print',
    setCode: 'CMR',
    collectorNumber: '1',
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    quantity: 1,
    ...over,
  };
}

function card(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c' + Math.random(),
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-print',
    purchasePrice: 2,
    sourceCategory: '',
    sourceFormat: 'list',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    ...over,
  };
}

function owned(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return { ...card(over), sourceFormat: 'manual' };
}

describe('summarizeListCost', () => {
  it('is zero/allOwned=false on an empty list', () => {
    expect(summarizeListCost([], [])).toEqual({
      totalCost: 0,
      unpricedCount: 0,
      unownedEntries: 0,
      allOwned: false,
    });
  });

  it('sums price for fully-unowned entries', () => {
    const rows = [
      { entry: entry({ quantity: 2 }), card: card({ purchasePrice: 3 }) },
      {
        entry: entry({ name: 'Arcane Signet', oracleId: 'o-as' }),
        card: card({ purchasePrice: 1 }),
      },
    ];
    expect(summarizeListCost(rows, [])).toEqual({
      totalCost: 7, // 2*3 + 1*1
      unpricedCount: 0,
      unownedEntries: 2,
      allOwned: false,
    });
  });

  it('only charges for the shortfall when partially owned', () => {
    const rows = [{ entry: entry({ quantity: 3 }), card: card({ purchasePrice: 5 }) }];
    const ownedCards = [owned(), owned()]; // owns 2 of 3
    expect(summarizeListCost(rows, ownedCards)).toEqual({
      totalCost: 5, // 1 shortfall * $5
      unpricedCount: 0,
      unownedEntries: 1,
      allOwned: false,
    });
  });

  it('counts unpriced shortfall entries separately instead of as $0', () => {
    const rows = [
      { entry: entry(), card: card({ purchasePrice: 0 }) },
      { entry: entry({ name: 'Other', oracleId: 'o-other' }), card: card({ purchasePrice: 4 }) },
    ];
    expect(summarizeListCost(rows, [])).toEqual({
      totalCost: 4,
      unpricedCount: 1,
      unownedEntries: 2,
      allOwned: false,
    });
  });

  it('reports allOwned when every entry is fully covered', () => {
    const rows = [{ entry: entry({ quantity: 2 }), card: card({ purchasePrice: 5 }) }];
    const ownedCards = [owned(), owned()];
    expect(summarizeListCost(rows, ownedCards)).toEqual({
      totalCost: 0,
      unpricedCount: 0,
      unownedEntries: 0,
      allOwned: true,
    });
  });
});
