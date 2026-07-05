import { describe, it, expect } from 'vitest';
import { findRedundantPins } from './binder-pin-dissolve';
import type { BinderDef, BinderFilter, BinderFilterGroup, EnrichedCard } from '../types';

function makeCard(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `id-${Math.random()}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

type BinderOverrides = Omit<Partial<BinderDef>, 'filterGroups'> & {
  filter?: BinderFilter;
  filterGroups?: BinderFilterGroup[];
};

function makeBinder(overrides: BinderOverrides = {}): BinderDef {
  const { filter, filterGroups, ...rest } = overrides;
  const groups: BinderFilterGroup[] =
    filterGroups ?? (filter !== undefined ? [{ filter }] : [{ filter: {} }]);
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: groups,
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...rest,
  };
}

describe('findRedundantPins', () => {
  it('flags a pin as redundant when the card would rule-match this binder anyway', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'rare' });
    const binder = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      pinnedCopyIds: ['c1'],
      pinnedKeys: ['sf:nonfoil'],
    });
    expect(findRedundantPins('rares', [card], [binder])).toEqual(['c1']);
  });

  it('keeps a pin that is actually doing work (card would land elsewhere without it)', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'common' });
    const binder = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      pinnedCopyIds: ['c1'],
    });
    expect(findRedundantPins('rares', [card], [binder])).toEqual([]);
  });

  it('keeps a pin that is doing work because the card would otherwise land in a different binder', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'rare' });
    const keepHere = makeBinder({
      id: 'keep-here',
      position: 0,
      // A filter this rare card does NOT match — without the pin, this
      // binder's rules would never claim it.
      filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } },
      pinnedCopyIds: ['c1'],
    });
    const rares = makeBinder({
      id: 'rares',
      position: 1,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    // Without the pin, this rare would route to `rares`, not `keep-here` — the
    // pin is load-bearing.
    expect(findRedundantPins('keep-here', [card], [keepHere, rares])).toEqual([]);
  });

  it('never flags a pin on a manual-mode binder (pins are the only reason it is there)', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'common' });
    const binder = makeBinder({
      id: 'manual',
      mode: 'manual',
      filter: {},
      pinnedCopyIds: ['c1'],
    });
    expect(findRedundantPins('manual', [card], [binder])).toEqual([]);
  });

  it('only evaluates pins on the requested binder, ignoring pins elsewhere', () => {
    const c1 = makeCard({ copyId: 'c1', rarity: 'rare' });
    const c2 = makeCard({ copyId: 'c2', rarity: 'common' });
    const rares = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      pinnedCopyIds: ['c1'],
    });
    const other = makeBinder({ id: 'other', filter: {}, pinnedCopyIds: ['c2'] });
    expect(findRedundantPins('rares', [c1, c2], [rares, other])).toEqual(['c1']);
  });

  it('skips a pinned copy that is no longer owned (reconcileBinderRefs handles that separately)', () => {
    const binder = makeBinder({ id: 'b1', filter: {}, pinnedCopyIds: ['ghost'] });
    expect(findRedundantPins('b1', [], [binder])).toEqual([]);
  });

  it('returns empty for a binder with no pins, or an unknown binder id', () => {
    const binder = makeBinder({ id: 'b1', filter: {} });
    expect(findRedundantPins('b1', [], [binder])).toEqual([]);
    expect(findRedundantPins('nope', [], [binder])).toEqual([]);
  });
});
