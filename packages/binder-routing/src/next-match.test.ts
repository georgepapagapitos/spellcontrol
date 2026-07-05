import { describe, it, expect } from 'vitest';
import { nextBinderMatch } from './next-match.js';
import type { EnrichedCard, BinderDef, BinderFilter, BinderFilterGroup } from './types.js';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: `copy-${Math.random()}`,
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
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    ...overrides,
  };
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

describe('nextBinderMatch', () => {
  it('falls through by position to the first binder whose rules match', () => {
    const red = makeBinder({
      id: 'red',
      position: 0,
      filter: { colors: { chips: [{ value: 'U', negate: false }], joiners: [] } },
    });
    const green = makeBinder({
      id: 'green',
      position: 1,
      filter: { colors: { chips: [{ value: 'R', negate: false }], joiners: [] } },
    });
    const card = makeCard({ colors: ['R'] });
    expect(nextBinderMatch(card, [red, green])?.id).toBe('green');
  });

  it('skips a binder whose excludedCopyIds names the card, continuing to the next match', () => {
    const first = makeBinder({ id: 'first', position: 0, filter: {}, excludedCopyIds: ['c1'] });
    const second = makeBinder({ id: 'second', position: 1, filter: {} });
    const card = makeCard({ copyId: 'c1' });
    expect(nextBinderMatch(card, [first, second])?.id).toBe('second');
  });

  it('skips manual-mode binders during rule routing', () => {
    const manual = makeBinder({ id: 'manual', position: 0, filter: {}, mode: 'manual' });
    const rules = makeBinder({ id: 'rules', position: 1, filter: {} });
    const card = makeCard();
    expect(nextBinderMatch(card, [manual, rules])?.id).toBe('rules');
  });

  it('a pin in a later-positioned binder claims the card ahead of an earlier rule match', () => {
    const rulesMatch = makeBinder({ id: 'rules', position: 0, filter: {} });
    const pinner = makeBinder({ id: 'pinner', position: 1, filter: {}, pinnedCopyIds: ['c1'] });
    const card = makeCard({ copyId: 'c1' });
    expect(nextBinderMatch(card, [rulesMatch, pinner])?.id).toBe('pinner');
  });

  it('respects excludeBinderId, skipping it even if it would otherwise claim the card', () => {
    const target = makeBinder({ id: 'target', position: 0, filter: {} });
    const fallback = makeBinder({ id: 'fallback', position: 1, filter: {} });
    const card = makeCard();
    expect(nextBinderMatch(card, [target, fallback], { excludeBinderId: 'target' })?.id).toBe(
      'fallback'
    );
  });

  it('returns null when no binder matches (would land in Uncategorized)', () => {
    const onlyMatchesBlue = makeBinder({
      id: 'blue',
      position: 0,
      filter: { colors: { chips: [{ value: 'U', negate: false }], joiners: [] } },
    });
    const card = makeCard({ colors: ['R'] });
    expect(nextBinderMatch(card, [onlyMatchesBlue])).toBeNull();
  });

  it('returns null for an empty binder list', () => {
    expect(nextBinderMatch(makeCard(), [])).toBeNull();
  });
});
