import { describe, it, expect } from 'vitest';
import { priceTier } from './scanner-feedback';
import type { ScryfallCard } from '@/deck-builder/types';

function card(prices: Partial<ScryfallCard['prices']>): Pick<ScryfallCard, 'prices'> {
  return { prices: { ...prices } as ScryfallCard['prices'] };
}

describe('priceTier', () => {
  it('falls back to tier 0 for missing / non-numeric prices', () => {
    expect(priceTier(null)).toBe(0);
    expect(priceTier(undefined)).toBe(0);
    expect(priceTier(card({}))).toBe(0);
    expect(priceTier(card({ usd: null }))).toBe(0);
    expect(priceTier(card({ usd: 'oops' }))).toBe(0);
  });

  it('buckets by USD price', () => {
    expect(priceTier(card({ usd: '0.10' }))).toBe(0);
    expect(priceTier(card({ usd: '0.99' }))).toBe(0);
    expect(priceTier(card({ usd: '1.00' }))).toBe(1);
    expect(priceTier(card({ usd: '4.99' }))).toBe(1);
    expect(priceTier(card({ usd: '5.00' }))).toBe(2);
    expect(priceTier(card({ usd: '19.99' }))).toBe(2);
    expect(priceTier(card({ usd: '20.00' }))).toBe(3);
    expect(priceTier(card({ usd: '250.00' }))).toBe(3);
  });

  it('falls through to usd_foil and usd_etched when usd is missing', () => {
    expect(priceTier(card({ usd_foil: '8.00' }))).toBe(2);
    expect(priceTier(card({ usd_etched: '25.00' }))).toBe(3);
  });

  it('prefers usd over fallback fields', () => {
    expect(priceTier(card({ usd: '0.50', usd_foil: '100.00' }))).toBe(0);
  });
});
