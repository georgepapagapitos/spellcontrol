import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { premiumBarPoints, premiumIsPaidFor } from './conversionPriceBar';

const card = (name: string, usd: string): ScryfallCard =>
  ({ name, type_line: 'Enchantment', prices: { usd } }) as unknown as ScryfallCard;

describe('conversion price bar (E572)', () => {
  // Sythis partial50: Exploration (42%, $30.70) left for Teferi's Protection
  // (22%, $48.58). Both sit far past the $2 free line, so the bar is the gap
  // between 8 points per price doubling at each price.
  const teferis = card("Teferi's Protection", '48.58');

  it('charges the extra doublings between the two prices', () => {
    const bar = premiumBarPoints(teferis, 48.58, 30.7);
    expect(bar).toBeGreaterThan(4);
    expect(bar).toBeLessThan(7);
  });

  it('is zero for a swap that costs the same or less', () => {
    expect(premiumBarPoints(teferis, 30.7, 48.58)).toBe(0);
    expect(premiumBarPoints(teferis, 5, 5)).toBe(0);
  });

  it('blocks a pricier card played far less than the staple it replaces', () => {
    expect(premiumIsPaidFor(teferis, 48.58, 22, 30.7, 42)).toBe(false);
  });

  it('allows a pricier card played enough more to pay the bar', () => {
    expect(premiumIsPaidFor(teferis, 48.58, 70, 30.7, 42)).toBe(true);
  });

  it('never blocks a swap that costs less', () => {
    expect(premiumIsPaidFor(teferis, 1, 10, 30.7, 42)).toBe(true);
  });

  it('treats a missing price as free', () => {
    expect(premiumBarPoints(teferis, Number.NaN, 0)).toBe(0);
  });
});
