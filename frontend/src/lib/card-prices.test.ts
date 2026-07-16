// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPrices,
  getPrice,
  loadPrices,
  priceKey,
  setPrices,
  _resetForTests,
} from './card-prices';
import { useCurrencyStore } from './currency';

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

  describe('display currency (EUR)', () => {
    beforeEach(() => {
      useCurrencyStore.getState().setCurrency('EUR');
    });
    afterEach(() => {
      useCurrencyStore.getState().setCurrency('USD');
    });

    it('applyPrices stamps the EUR price when EUR is active', () => {
      setPrices({ s1: { usd: 9.99, eur: 8.4, pricedAt: 42 } });
      const out = applyPrices<{ scryfallId: string; purchasePrice?: number; pricedAt?: number }>([
        { scryfallId: 's1', purchasePrice: 0 },
      ]);
      expect(out[0].purchasePrice).toBe(8.4);
      expect(out[0].pricedAt).toBe(42);
    });

    it('treats a pre-EUR cache entry (no eur field) as never priced so it re-fetches', () => {
      setPrices({ s1: { usd: 9.99, pricedAt: 42 } });
      const out = applyPrices([{ scryfallId: 's1', purchasePrice: 9.99, pricedAt: 42 }]);
      expect(out[0].purchasePrice).toBe(0);
      expect(out[0].pricedAt).toBeUndefined(); // maximally stale → refresh backfills
    });

    it('a fetched-but-unpriced EUR entry (eur: 0) stays an honest €0, not stale', () => {
      setPrices({ s1: { usd: 9.99, eur: 0, pricedAt: 42 } });
      const out = applyPrices<{ scryfallId: string; purchasePrice?: number; pricedAt?: number }>([
        { scryfallId: 's1', purchasePrice: 0 },
      ]);
      expect(out[0].purchasePrice).toBe(0);
      expect(out[0].pricedAt).toBe(42);
    });

    it('switching back to USD re-reads the USD side of the same entry', () => {
      setPrices({ s1: { usd: 9.99, eur: 8.4, pricedAt: 42 } });
      useCurrencyStore.getState().setCurrency('USD');
      const out = applyPrices([{ scryfallId: 's1', purchasePrice: 0 }]);
      expect(out[0].purchasePrice).toBe(9.99);
    });

    it('setPrices detects an eur-only change as a real update', () => {
      setPrices({ s1: { usd: 5, pricedAt: 1 } });
      setPrices({ s1: { usd: 5, eur: 4.2, pricedAt: 1 } });
      expect(getPrice('s1')).toEqual({ usd: 5, eur: 4.2, pricedAt: 1 });
    });
  });

  describe('finish-aware pricing', () => {
    it('priceKey: non-foil is the bare id; foil/etched get their own key', () => {
      expect(priceKey('s1')).toBe('s1');
      expect(priceKey('s1', 'nonfoil')).toBe('s1');
      expect(priceKey('s1', 'foil')).toBe('s1:foil');
      expect(priceKey('s1', 'etched')).toBe('s1:etched');
    });

    it('a foil reads the foil price, not the non-foil one', () => {
      setPrices({ s1: { usd: 2, pricedAt: 1 }, 's1:foil': { usd: 9, pricedAt: 1 } });
      const out = applyPrices([
        { scryfallId: 's1', finish: 'foil', purchasePrice: 0 },
        { scryfallId: 's1', finish: 'nonfoil', purchasePrice: 0 },
      ]);
      expect(out[0].purchasePrice).toBe(9); // foil
      expect(out[1].purchasePrice).toBe(2); // non-foil
    });

    it('a foil with no finish-specific entry falls back to the non-foil price (transitional)', () => {
      // Legacy cache: only the bare non-foil entry exists, no foil key yet.
      setPrices({ s1: { usd: 2, pricedAt: 1 } });
      const out = applyPrices([{ scryfallId: 's1', finish: 'foil', purchasePrice: 0 }]);
      expect(out[0].purchasePrice).toBe(2);
    });

    it('getPrice resolves the finish-specific entry', () => {
      setPrices({ s1: { usd: 2, pricedAt: 1 }, 's1:etched': { usd: 30, pricedAt: 1 } });
      expect(getPrice('s1')?.usd).toBe(2);
      expect(getPrice('s1', 'etched')?.usd).toBe(30);
      expect(getPrice('s1', 'foil')).toBeUndefined();
    });
  });
});
