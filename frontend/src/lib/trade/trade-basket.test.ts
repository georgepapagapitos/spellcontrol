import { describe, expect, it } from 'vitest';
import { atLineCap, keyOf, resolveGivePrefill } from './trade-basket';
import { MAX_TRADE_LINES_PER_SIDE, type TradeCard } from './trades-client';
import type { OwnedTradeLine } from './trade-picker';
import type { EnrichedCard } from '../../types';

function copy(copyId: string, price: number): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    oracleId: 'o-sol',
    setCode: 'C21',
    setName: 'Commander 2021',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: `sf-${copyId}`,
    purchasePrice: price,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

const ask = (oracleId: string, name: string, quantity: number): TradeCard =>
  ({ oracleId, name, quantity, copies: [] }) as unknown as TradeCard;

describe('keyOf', () => {
  it('keys by oracle id, falling back to the lowercased name', () => {
    expect(keyOf({ oracleId: 'o-1', name: 'Sol Ring' })).toBe('o-1');
    expect(keyOf({ oracleId: '', name: 'Sol Ring' })).toBe('name:sol ring');
  });
});

describe('atLineCap', () => {
  it('caps a new line at the server limit but never a line already in the basket', () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_TRADE_LINES_PER_SIDE }, (_, i) => [`k${i}`, 1])
    );
    expect(atLineCap(full, 'new')).toBe(true);
    expect(atLineCap(full, 'k0')).toBe(false);
    expect(atLineCap({}, 'new')).toBe(false);
  });
});

describe('resolveGivePrefill', () => {
  const owned = new Map<string, OwnedTradeLine>([
    [
      'o-sol',
      {
        oracleId: 'o-sol',
        name: 'Sol Ring',
        copies: [copy('dear', 9), copy('cheap', 1), copy('mid', 3)],
      },
    ],
  ]);

  it('takes the cheapest owned copies up to the asked quantity', () => {
    const { prefill, skipped } = resolveGivePrefill([ask('o-sol', 'Sol Ring', 2)], owned);
    expect(prefill).toEqual({ 'o-sol': ['cheap', 'mid'] });
    expect(skipped).toEqual([]);
  });

  it('names a card owned short of the ask, and one not owned at all', () => {
    const { prefill, skipped } = resolveGivePrefill(
      [ask('o-sol', 'Sol Ring', 4), ask('o-rhy', 'Rhystic Study', 1)],
      owned
    );
    expect(prefill).toEqual({ 'o-sol': ['cheap', 'mid', 'dear'] });
    expect(skipped).toEqual(['Sol Ring', 'Rhystic Study']);
  });

  it('is empty with nothing to prefill', () => {
    expect(resolveGivePrefill(undefined, owned)).toEqual({ prefill: {}, skipped: [] });
  });
});
