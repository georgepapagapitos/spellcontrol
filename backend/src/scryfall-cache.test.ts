import { describe, it, expect } from 'vitest';
import {
  buildPriceRefreshPayload,
  pickEurForFinish,
  pickUsdForFinish,
  pickUsdFromPrices,
} from './scryfall-cache';
import type { ScryfallCard } from './types';

const card = (prices: Record<string, string | null> | undefined): ScryfallCard =>
  ({ prices }) as unknown as ScryfallCard;

describe('pickUsdFromPrices', () => {
  it('prefers nonfoil usd', () => {
    expect(pickUsdFromPrices(card({ usd: '4.50', usd_foil: '20', usd_etched: '30' }))).toBe(4.5);
  });

  it('falls back to etched then foil when usd is missing', () => {
    expect(pickUsdFromPrices(card({ usd: null, usd_etched: '12.00', usd_foil: '9' }))).toBe(12);
    expect(pickUsdFromPrices(card({ usd: null, usd_etched: null, usd_foil: '9.25' }))).toBe(9.25);
  });

  it('returns 0 when there is no usable price', () => {
    expect(pickUsdFromPrices(card({ usd: null, usd_foil: null, usd_etched: null }))).toBe(0);
    expect(pickUsdFromPrices(card(undefined))).toBe(0);
    expect(pickUsdFromPrices(card({ usd: '0' }))).toBe(0);
    expect(pickUsdFromPrices(card({ usd: 'not-a-number' }))).toBe(0);
  });
});

describe('pickUsdForFinish', () => {
  const p = { usd: '1.50', usd_foil: '5.00', usd_etched: '12.00' };

  it('picks the price matching the owned finish', () => {
    expect(pickUsdForFinish(card(p), 'nonfoil')).toBe(1.5);
    expect(pickUsdForFinish(card(p), 'foil')).toBe(5);
    expect(pickUsdForFinish(card(p), 'etched')).toBe(12);
  });

  it('treats a missing/unknown finish as non-foil', () => {
    expect(pickUsdForFinish(card(p))).toBe(1.5);
    expect(pickUsdForFinish(card(p), 'weird')).toBe(1.5);
  });

  it('falls back across finishes when the owned finish has no price', () => {
    // Foil price missing → foil falls back to etched, then nonfoil.
    expect(pickUsdForFinish(card({ usd: '2', usd_etched: '8', usd_foil: null }), 'foil')).toBe(8);
    expect(pickUsdForFinish(card({ usd: '2', usd_etched: null, usd_foil: null }), 'foil')).toBe(2);
  });

  it('returns 0 when nothing is priced', () => {
    expect(pickUsdForFinish(card({ usd: null }), 'foil')).toBe(0);
    expect(pickUsdForFinish(card(undefined), 'foil')).toBe(0);
  });
});

describe('pickEurForFinish', () => {
  const p = { eur: '1.20', eur_foil: '4.80' };

  it('picks the price matching the owned finish', () => {
    expect(pickEurForFinish(card(p), 'nonfoil')).toBe(1.2);
    expect(pickEurForFinish(card(p), 'foil')).toBe(4.8);
    // Scryfall has no eur_etched — etched reads foil-first.
    expect(pickEurForFinish(card(p), 'etched')).toBe(4.8);
  });

  it('falls back across finishes and defaults unknown finish to non-foil', () => {
    expect(pickEurForFinish(card({ eur: '2', eur_foil: null }), 'foil')).toBe(2);
    expect(pickEurForFinish(card({ eur: null, eur_foil: '3' }))).toBe(3);
    expect(pickEurForFinish(card(p), 'weird')).toBe(1.2);
  });

  it('returns 0 when Scryfall has no EUR price', () => {
    expect(pickEurForFinish(card({ usd: '5', eur: null, eur_foil: null }), 'nonfoil')).toBe(0);
    expect(pickEurForFinish(card(undefined))).toBe(0);
  });
});

describe('buildPriceRefreshPayload', () => {
  const printing = (id: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
    ({ id, ...over }) as unknown as ScryfallCard;

  it('emits per-finish prices only for printings that have one', () => {
    const { prices } = buildPriceRefreshPayload(
      [
        printing('priced', { prices: { usd: '3.00', usd_foil: '9.00' } }),
        printing('unpriced', { prices: { usd: null, usd_foil: null, usd_etched: null } }),
        printing('no-prices-at-all'),
      ],
      1234
    );
    expect(prices.priced).toMatchObject({ usd: 3, usdFoil: 9, pricedAt: 1234 });
    expect(prices.unpriced).toBeUndefined();
    expect(prices['no-prices-at-all']).toBeUndefined();
  });

  // The release date must NOT inherit the price gate. Gating it would starve
  // exactly the unpriced printings — which then keep dating from their set, and
  // for a rolling container set that is years off.
  it('emits a release date whether or not the printing is priced', () => {
    const { prices, releasedAt } = buildPriceRefreshPayload(
      [
        printing('priced', { released_at: '2024-02-23', prices: { usd: '3.00' } }),
        printing('unpriced', { released_at: '2026-09-11', prices: { usd: null } }),
        printing('dateless', { prices: { usd: '1.00' } }),
      ],
      1234
    );
    expect(releasedAt).toEqual({ priced: '2024-02-23', unpriced: '2026-09-11' });
    expect(prices.unpriced).toBeUndefined();
  });

  it('returns empty maps for no cards', () => {
    expect(buildPriceRefreshPayload([], 1)).toEqual({ prices: {}, releasedAt: {} });
  });
});
