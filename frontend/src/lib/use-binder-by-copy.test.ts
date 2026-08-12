import { describe, it, expect } from 'vitest';
import { buildBinderByCopyId } from './use-binder-by-copy';
import type { BinderDef, BinderFilter, EnrichedCard } from '../types';

function copy(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Sol Ring',
    oracleId: 'sol',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Artifact',
    ...overrides,
  } as EnrichedCard;
}

function binder(
  overrides: Partial<Omit<BinderDef, 'filterGroups'>> & { filter?: BinderFilter } = {}
): BinderDef {
  const { filter, ...rest } = overrides;
  return {
    id: 'b1',
    name: 'Staples',
    position: 0,
    filterGroups: [{ filter: filter ?? {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#abc',
    createdAt: 0,
    updatedAt: 0,
    ...rest,
  };
}

const NONE = new Set<string>();

describe('buildBinderByCopyId', () => {
  it('maps each seated copy to the binder holding it', () => {
    const map = buildBinderByCopyId([copy({ copyId: 'c1' })], [binder()], NONE, undefined);
    expect(map.get('c1')).toEqual([{ id: 'b1', name: 'Staples', color: '#abc' }]);
  });

  it('is empty when there are no binders to route into', () => {
    expect(buildBinderByCopyId([copy({ copyId: 'c1' })], [], NONE, undefined).size).toBe(0);
  });

  it('leaves a copy no binder claims unmapped', () => {
    const map = buildBinderByCopyId(
      [copy({ copyId: 'c1', purchasePrice: 0.1 })],
      [binder({ filter: { priceMin: 5 } })],
      NONE,
      undefined
    );
    expect(map.has('c1')).toBe(false);
  });

  it('still files a deck-allocated copy by default', () => {
    // Hiding deck-allocated cards is opt-IN per binder, so a copy can legitimately
    // be both in a deck and in a binder — the trade rows show both badges.
    const map = buildBinderByCopyId(
      [copy({ copyId: 'c1' })],
      [binder()],
      new Set(['c1']),
      undefined
    );
    expect(map.has('c1')).toBe(true);
  });

  it('omits a deck-allocated copy from a binder that hides them', () => {
    const map = buildBinderByCopyId(
      [copy({ copyId: 'c1' })],
      [binder({ hideDeckAllocated: false })],
      new Set(['c1']),
      undefined
    );
    expect(map.has('c1')).toBe(false);
  });

  it('routes each copy to its own binder, first match wins per copy', () => {
    const cards = [
      copy({ copyId: 'cheap', purchasePrice: 0.1 }),
      copy({ copyId: 'pricey', purchasePrice: 50 }),
    ];
    const defs = [
      binder({ id: 'high', name: 'Chase', position: 0, filter: { priceMin: 10 } }),
      binder({ id: 'rest', name: 'Bulk', position: 1 }),
    ];
    const map = buildBinderByCopyId(cards, defs, NONE, undefined);
    expect(map.get('pricey')?.map((b) => b.id)).toEqual(['high']);
    expect(map.get('cheap')?.map((b) => b.id)).toEqual(['rest']);
  });

  it('never lists the same binder twice for one copy', () => {
    const map = buildBinderByCopyId([copy({ copyId: 'c1' })], [binder()], NONE, undefined);
    expect(map.get('c1')).toHaveLength(1);
  });
});
