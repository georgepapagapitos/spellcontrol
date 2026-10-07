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
  const paid = (over: Partial<Parameters<typeof premiumIsPaidFor>[0]>) =>
    premiumIsPaidFor({
      incoming: teferis,
      incomingPrice: 48.58,
      incomingInclusion: 22,
      leavingPrice: 30.7,
      leavingInclusion: 42,
      scoreSurplus: 0,
      ...over,
    });

  it('charges the extra doublings between the two prices', () => {
    const bar = premiumBarPoints(teferis, 48.58, 30.7);
    expect(bar).toBeGreaterThan(4);
    expect(bar).toBeLessThan(7);
  });

  it('is zero for a swap that costs the same or less', () => {
    expect(premiumBarPoints(teferis, 30.7, 48.58)).toBe(0);
    expect(premiumBarPoints(teferis, 5, 5)).toBe(0);
  });

  it('is zero for an incoming card at or under the free line', () => {
    // Path to Exile ($0.75) for Astral Cornucopia ($0.29): no real premium.
    expect(premiumBarPoints(card('Path to Exile', '0.75'), 0.75, 0.29)).toBe(0);
    expect(premiumBarPoints(card('Edgar', '2.00'), 2, 0.1)).toBe(0);
  });

  it('blocks a pricier card played far less than the staple it replaces', () => {
    expect(paid({ scoreSurplus: 60 })).toBe(false);
  });

  it('allows a pricier card played enough more than a staple to pay the bar', () => {
    expect(paid({ incomingInclusion: 70 })).toBe(true);
  });

  it('judges a non-staple on the survival score, not raw inclusion', () => {
    // Reanimate (29.7%, $9.81) for a 15% card: theme and synergy lift the score.
    const base = {
      incoming: card('Reanimate', '9.81'),
      incomingPrice: 9.81,
      incomingInclusion: 29.7,
      leavingPrice: 0.3,
      leavingInclusion: 15,
    };
    expect(premiumIsPaidFor({ ...base, scoreSurplus: 40 })).toBe(true);
    expect(premiumIsPaidFor({ ...base, scoreSurplus: 2 })).toBe(false);
  });

  it('never blocks a swap that costs less', () => {
    expect(paid({ incomingPrice: 1 })).toBe(true);
  });

  it('treats a missing price as free', () => {
    expect(premiumBarPoints(teferis, Number.NaN, 0)).toBe(0);
  });
});
