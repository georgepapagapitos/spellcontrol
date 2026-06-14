// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPrices, getPrice, loadPrices, setPrices, _resetForTests } from './card-prices';

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
});

describe('card-prices', () => {
  it('setPrices stores and getPrice reads back, surviving a reload', () => {
    setPrices({ a: { usd: 3.5, pricedAt: 100 } });
    expect(getPrice('a')).toEqual({ usd: 3.5, pricedAt: 100 });
    // Simulate a fresh page load: clear the in-memory cache but keep localStorage.
    _resetForTests();
    loadPrices();
    expect(getPrice('a')).toEqual({ usd: 3.5, pricedAt: 100 });
  });

  it('applyPrices fills purchasePrice/pricedAt from the cache by scryfallId', () => {
    setPrices({ s1: { usd: 9.99, pricedAt: 42 } });
    const out = applyPrices([
      { scryfallId: 's1', purchasePrice: 0 } as {
        scryfallId: string;
        purchasePrice: number;
        pricedAt?: number;
      },
    ]);
    expect(out[0].purchasePrice).toBe(9.99);
    expect(out[0].pricedAt).toBe(42);
  });

  it('applyPrices coerces a stripped card (no price) with no cache entry to 0, never NaN', () => {
    const out = applyPrices([
      { scryfallId: 'unknown' } as { scryfallId: string; purchasePrice?: number },
    ]);
    expect(out[0].purchasePrice).toBe(0);
    expect(Number.isNaN(out[0].purchasePrice)).toBe(false);
  });

  it('applyPrices keeps a legacy baked-in price when the cache has no entry', () => {
    // First boot after upgrade: row still carries a price, cache empty for it.
    const out = applyPrices([{ scryfallId: 'legacy', purchasePrice: 4.25, pricedAt: 7 }]);
    expect(out[0].purchasePrice).toBe(4.25);
  });

  it('applyPrices returns the same array reference when nothing changes (memo-friendly)', () => {
    setPrices({ s1: { usd: 5, pricedAt: 1 } });
    const cards = [{ scryfallId: 's1', purchasePrice: 5, pricedAt: 1 }];
    expect(applyPrices(cards)).toBe(cards);
  });
});
