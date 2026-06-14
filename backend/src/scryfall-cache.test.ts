import { describe, it, expect } from 'vitest';
import { pickUsdFromPrices } from './scryfall-cache';
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
