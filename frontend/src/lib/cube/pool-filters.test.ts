import { describe, it, expect } from 'vitest';
import { filterPool, DEFAULT_POOL_FILTERS, type PoolFilters } from './pool-filters';
import type { EnrichedCard } from '@/types';

let n = 0;
const copy = (name: string, p: Partial<EnrichedCard> = {}) =>
  ({ copyId: `c${n++}`, name, rarity: 'rare', purchasePrice: 3, ...p }) as EnrichedCard;

const collection = [
  copy('Sol Ring', { rarity: 'uncommon', purchasePrice: 2 }),
  copy('Sol Ring', { rarity: 'uncommon', purchasePrice: 1.5 }),
  copy('Swords to Plowshares', { rarity: 'uncommon', purchasePrice: 1 }),
  copy('Rhystic Study', { rarity: 'common', purchasePrice: 40 }),
  copy('Llanowar Elves', { rarity: 'common', purchasePrice: 0.25 }),
  copy('Mystery Card', { rarity: 'mythic', purchasePrice: 0 }),
  copy('Committed Card', { rarity: 'common', purchasePrice: 0.5 }),
];
// Everything is free except the one whose only copy sits in a deck.
const available = new Set(collection.map((c) => c.name).filter((x) => x !== 'Committed Card'));
const run = (f: Partial<PoolFilters>) =>
  filterPool(collection, available, { ...DEFAULT_POOL_FILTERS, ...f });

describe('filterPool', () => {
  it('default = available names, one per unique name, committed hidden', () => {
    const { names, hidden } = run({});
    expect(names).toEqual([
      'Sol Ring',
      'Swords to Plowshares',
      'Rhystic Study',
      'Llanowar Elves',
      'Mystery Card',
    ]);
    expect(hidden).toEqual({ committed: 1, singles: 0, rarity: 0, price: 0, unpriced: 0 });
  });

  it('all = every owned name, nothing hidden', () => {
    const { names, hidden } = run({ source: 'all' });
    expect(names).toHaveLength(6);
    expect(hidden.committed).toBe(0);
  });

  it('spares = available AND two or more copies owned', () => {
    const { names, hidden } = run({ source: 'spares' });
    expect(names).toEqual(['Sol Ring']);
    expect(hidden.singles).toBe(4);
    expect(hidden.committed).toBe(1);
  });

  it('rarity caps read the OWNED copy: peasant keeps common + uncommon, pauper common only', () => {
    expect(run({ rarity: 'peasant' }).names).toEqual([
      'Sol Ring',
      'Swords to Plowshares',
      'Rhystic Study',
      'Llanowar Elves',
    ]);
    const pauper = run({ rarity: 'pauper' });
    expect(pauper.names).toEqual(['Rhystic Study', 'Llanowar Elves']);
    expect(pauper.hidden.rarity).toBe(3);
  });

  it('price ceiling uses the cheapest priced copy and hides the unpriced', () => {
    const { names, hidden } = run({ maxPrice: 1.5 });
    // Sol Ring's cheaper copy ($1.50) clears the bar; Rhystic ($40) does not;
    // Mystery Card has no price yet and is hidden rather than let through.
    expect(names).toEqual(['Sol Ring', 'Swords to Plowshares', 'Llanowar Elves']);
    expect(hidden.price).toBe(1);
    expect(hidden.unpriced).toBe(1);
  });

  it('filters compose, and every hidden name is counted exactly once', () => {
    const { names, hidden } = run({ source: 'spares', rarity: 'pauper', maxPrice: 1 });
    expect(names).toEqual([]);
    const total = Object.values(hidden).reduce((s, v) => s + v, 0);
    expect(total).toBe(6);
  });
});
