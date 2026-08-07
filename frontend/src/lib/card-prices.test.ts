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

  it('applyPrices zeroes a proxy copy even though the cache has a real price for the printing (E204)', () => {
    setPrices({ s1: { usd: 42, pricedAt: 100 } });
    const [proxyCard, realCard] = applyPrices<{
      scryfallId: string;
      proxy?: boolean;
      purchasePrice: number;
      pricedAt?: number;
    }>([
      { scryfallId: 's1', proxy: true, purchasePrice: 0 },
      { scryfallId: 's1', purchasePrice: 0 },
    ]);
    expect(proxyCard.purchasePrice).toBe(0);
    expect(proxyCard.pricedAt).toBeUndefined();
    // A non-proxy copy of the same printing is unaffected.
    expect(realCard.purchasePrice).toBe(42);
  });

  it('applyPrices is a no-op reference for an already-zeroed proxy', () => {
    setPrices({ s1: { usd: 42, pricedAt: 100 } });
    const cards = [{ scryfallId: 's1', proxy: true, purchasePrice: 0 }];
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

  describe('priceOverride (E204)', () => {
    it('wins over the live cache, denominated in USD by default', () => {
      setPrices({ s1: { usd: 42, pricedAt: 100 } });
      const out = applyPrices<{
        scryfallId: string;
        purchasePrice: number;
        pricedAt?: number;
        priceOverride?: number;
      }>([{ scryfallId: 's1', purchasePrice: 0, priceOverride: 12.5 }]);
      expect(out[0].purchasePrice).toBe(12.5);
      // No live fetch backs this number, so freshness is honestly unknown.
      expect(out[0].pricedAt).toBeUndefined();
    });

    it('wins over the proxy-zeroing default — an explicit override is more specific', () => {
      const out = applyPrices<{
        scryfallId: string;
        proxy?: boolean;
        purchasePrice: number;
        priceOverride?: number;
      }>([{ scryfallId: 's1', proxy: true, purchasePrice: 0, priceOverride: 8 }]);
      expect(out[0].purchasePrice).toBe(8);
    });

    it('survives a refresh that writes a fresh cache value for the same printing', () => {
      const cards: Array<{
        scryfallId: string;
        purchasePrice: number;
        pricedAt?: number;
        priceOverride?: number;
      }> = [{ scryfallId: 's1', purchasePrice: 0, priceOverride: 5 }];
      const afterOverride = applyPrices(cards);
      expect(afterOverride[0].purchasePrice).toBe(5);
      // A price refresh writes new market data to the device-local cache…
      setPrices({ s1: { usd: 99, pricedAt: 200 } });
      // …but re-applying still shows the override, not the refreshed market price.
      const afterRefresh = applyPrices(afterOverride);
      expect(afterRefresh[0].purchasePrice).toBe(5);
    });

    it('is a no-op reference once purchasePrice already matches the override', () => {
      const cards = [{ scryfallId: 's1', purchasePrice: 5, priceOverride: 5 }];
      expect(applyPrices(cards)).toBe(cards);
    });

    it('falls back to the real market price when the override currency does not match the active display currency', () => {
      setPrices({ s1: { usd: 9.99, eur: 8.4, pricedAt: 42 } });
      useCurrencyStore.getState().setCurrency('EUR');
      try {
        const out = applyPrices<{
          scryfallId: string;
          purchasePrice: number;
          priceOverride?: number;
          priceOverrideCurrency?: string;
        }>([
          {
            scryfallId: 's1',
            purchasePrice: 0,
            priceOverride: 12,
            priceOverrideCurrency: 'USD',
          },
        ]);
        // Override was recorded in USD but the viewer is in EUR — fall back to
        // the real (EUR) market price rather than showing a wrong-currency number.
        expect(out[0].purchasePrice).toBe(8.4);
      } finally {
        useCurrencyStore.getState().setCurrency('USD');
      }
    });

    it('applies once the active currency matches priceOverrideCurrency', () => {
      const out = applyPrices<{
        scryfallId: string;
        purchasePrice: number;
        priceOverride?: number;
        priceOverrideCurrency?: string;
      }>([{ scryfallId: 's1', purchasePrice: 0, priceOverride: 12, priceOverrideCurrency: 'USD' }]);
      expect(out[0].purchasePrice).toBe(12);
    });

    it('an absent override is never treated as $0 — falls through to real market resolution', () => {
      setPrices({ s1: { usd: 7, pricedAt: 1 } });
      const out = applyPrices<{
        scryfallId: string;
        purchasePrice: number;
        priceOverride?: number;
      }>([{ scryfallId: 's1', purchasePrice: 0 }]);
      expect(out[0].purchasePrice).toBe(7);
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
