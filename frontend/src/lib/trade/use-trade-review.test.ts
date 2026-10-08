import { describe, expect, it } from 'vitest';
import { theirFloorPrices } from './use-trade-review';
import type { PublicCard } from '@/lib/social/shared-types';

const copy = (oracleId: string, purchasePrice: number) =>
  ({ name: oracleId, oracleId, purchasePrice }) as PublicCard;

describe('theirFloorPrices', () => {
  it('is the cheapest priced printing of each card', () => {
    const floors = theirFloorPrices([copy('a', 5), copy('a', 3), copy('b', 2)]);
    expect(floors.get('a')).toBe(3);
    expect(floors.get('b')).toBe(2);
  });

  it('leaves a card with no priced copy out, so the lookup can price it', () => {
    const floors = theirFloorPrices([copy('a', 0), copy('b', 4)]);
    expect(floors.has('a')).toBe(false);
    expect(theirFloorPrices(null).size).toBe(0);
  });
});
