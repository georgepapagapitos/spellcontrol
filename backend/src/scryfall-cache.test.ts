import { describe, it, expect } from 'vitest';
import { pickUsdForFinish, pickUsdFromPrices } from './scryfall-cache';
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
