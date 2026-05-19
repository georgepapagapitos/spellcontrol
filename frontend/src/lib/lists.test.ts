import { describe, it, expect } from 'vitest';
import type { EnrichedCard, ListEntry } from '../types';
import {
  MAX_LIST_NAME,
  clampListName,
  makeListEntry,
  ownedCountForEntry,
  entryToCards,
} from './lists';

function owned(over: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: 'c' + Math.random(),
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-print',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    ...over,
  };
}

const entry: ListEntry = {
  id: 'e1',
  name: 'Sol Ring',
  scryfallId: 'sf-print',
  setCode: 'CMR',
  collectorNumber: '1',
  finish: 'nonfoil',
  oracleId: 'oracle-solring',
  quantity: 2,
};

describe('clampListName', () => {
  it('trims and clamps', () => {
    expect(clampListName('  Wants  ')).toBe('Wants');
    expect(clampListName('x'.repeat(MAX_LIST_NAME + 5))).toHaveLength(MAX_LIST_NAME);
  });
});

describe('makeListEntry', () => {
  it('builds an entry from an enriched-ish card with an id and clamped qty', () => {
    const e = makeListEntry(owned({ scryfallId: 'sf9', collectorNumber: '42' }), 3);
    expect(e.id).toBeTruthy();
    expect(e).toMatchObject({
      name: 'Sol Ring',
      scryfallId: 'sf9',
      setCode: 'CMR',
      collectorNumber: '42',
      finish: 'nonfoil',
      oracleId: 'oracle-solring',
      quantity: 3,
    });
  });
  it('defaults quantity to 1 and floors below 1', () => {
    expect(makeListEntry(owned({}), 0).quantity).toBe(1);
    expect(makeListEntry(owned({})).quantity).toBe(1);
  });
});

describe('ownedCountForEntry', () => {
  it('counts owned copies by oracleId', () => {
    const cards = [owned({}), owned({ scryfallId: 'other-print' }), owned({ oracleId: 'x' })];
    expect(ownedCountForEntry(entry, cards)).toBe(2);
  });
  it('falls back to name match when entry has no oracleId', () => {
    const noOracle = { ...entry, oracleId: undefined };
    const cards = [owned({ oracleId: undefined }), owned({ name: 'Other', oracleId: undefined })];
    expect(ownedCountForEntry(noOracle, cards)).toBe(1);
  });
  it('is zero when nothing matches', () => {
    expect(ownedCountForEntry(entry, [owned({ oracleId: 'nope' })])).toBe(0);
  });
});

describe('entryToCards', () => {
  it('produces `quantity` EnrichedCards with fresh unique copyIds from the entry printing', () => {
    const cards = entryToCards(entry);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.copyId)).size).toBe(2);
    expect(cards[0]).toMatchObject({
      name: 'Sol Ring',
      scryfallId: 'sf-print',
      setCode: 'CMR',
      collectorNumber: '1',
      finish: 'nonfoil',
      foil: false,
      oracleId: 'oracle-solring',
    });
  });
  it('sets foil=true for foil/etched finishes', () => {
    expect(entryToCards({ ...entry, finish: 'foil', quantity: 1 })[0].foil).toBe(true);
  });
});
