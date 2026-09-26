import { describe, it, expect } from 'vitest';
import { buildCubePullList, isPullableGroupKind } from './pull-list';
import type { CubePickSlot } from '../../store/cube';
import type { CubeCard } from './core';
import type { BinderDef, BinderFilter, EnrichedCard } from '../../types';

function makeCopy(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-test',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function makeBinder(
  overrides: Partial<Omit<BinderDef, 'filterGroups'>> & { filter?: BinderFilter } = {}
): BinderDef {
  const { filter, ...rest } = overrides;
  return {
    id: 'binder',
    name: 'Test Binder',
    position: 0,
    filterGroups: [{ filter: filter ?? {} }],
    sorts: [{ field: 'none', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: 0,
    updatedAt: 0,
    ...rest,
  };
}

function makeCubeCard(overrides: Partial<CubeCard> & { name: string; oracleId: string }): CubeCard {
  return { colors: [], cmc: 1, typeLine: 'Artifact', role: null, ...overrides };
}

function makePick(
  overrides: Partial<CubePickSlot> & { slotId: string; card: CubeCard }
): CubePickSlot {
  return { allocatedCopyId: null, printingFinishKey: null, ...overrides };
}

describe('buildCubePullList', () => {
  it('orders rows by binder position, then page, then slot', () => {
    // 5 cards, pocket size 2: page 1 = A,B / page 2 = C,D / page 3 = E — a
    // binder in the user's own sort order (name A→E) sorted alphabetically.
    const names = ['A', 'B', 'C', 'D', 'E'];
    const collection = names.map((n) =>
      makeCopy({ copyId: `c-${n}`, name: n, scryfallId: `sf-${n}` })
    );
    const binder = makeBinder({ id: 'main', position: 0, pocketSize: 4 });
    const picks: CubePickSlot[] = names.map((n) =>
      makePick({
        slotId: `pick-${n}`,
        card: makeCubeCard({ name: n, oracleId: `oid-${n}` }),
        allocatedCopyId: `c-${n}`,
      })
    );
    const groups = buildCubePullList(picks, collection, [binder]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'binder:main', kind: 'binder', label: 'Test Binder' });
    expect(groups[0].rows.map((r) => [r.name, r.pageNum, r.slotNum])).toEqual([
      ['A', 1, 1],
      ['B', 1, 2],
      ['C', 1, 3],
      ['D', 1, 4],
      ['E', 2, 1],
    ]);
  });

  it('lists binder groups in binder position order, not definition order', () => {
    const cardA = makeCopy({ copyId: 'a', name: 'Alpha', scryfallId: 'sf-a' });
    const cardB = makeCopy({ copyId: 'b', name: 'Beta', scryfallId: 'sf-b' });
    // "Second" (position 1) claims Beta; "First" (position 0) claims Alpha.
    const first = makeBinder({
      id: 'first',
      name: 'First',
      position: 0,
      filter: { nameContains: 'Alpha' },
    });
    const second = makeBinder({
      id: 'second',
      name: 'Second',
      position: 1,
      filter: { nameContains: 'Beta' },
    });
    const picks: CubePickSlot[] = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Beta', oracleId: 'oid-b' }),
        allocatedCopyId: 'b',
      }),
      makePick({
        slotId: 'p2',
        card: makeCubeCard({ name: 'Alpha', oracleId: 'oid-a' }),
        allocatedCopyId: 'a',
      }),
    ];
    // Pass binder defs out of position order — the pull list must still sort by position.
    const groups = buildCubePullList(picks, [cardA, cardB], [second, first]);
    expect(groups.map((g) => g.label)).toEqual(['First', 'Second']);
  });

  it('handles pocket-size arithmetic at 4, 9 and 12', () => {
    for (const pocketSize of [4, 9, 12] as const) {
      const count = pocketSize * 2 + 1; // spans 3 pages exactly
      const names = Array.from({ length: count }, (_, i) => `Card ${String(i).padStart(3, '0')}`);
      const collection = names.map((n, i) =>
        makeCopy({ copyId: `c${i}`, name: n, scryfallId: `sf${i}` })
      );
      const binder = makeBinder({ id: 'b', position: 0, pocketSize });
      const picks = names.map((n, i) =>
        makePick({
          slotId: `p${i}`,
          card: makeCubeCard({ name: n, oracleId: `o${i}` }),
          allocatedCopyId: `c${i}`,
        })
      );
      const groups = buildCubePullList(picks, collection, [binder]);
      const rows = groups[0].rows;
      // Last card of the third page sits at pageNum 3, slotNum 1.
      const last = rows[rows.length - 1];
      expect(last.pageNum).toBe(3);
      expect(last.slotNum).toBe(1);
      // Every page boundary lines up with the pocket size.
      expect(rows.filter((r) => r.pageNum === 1)).toHaveLength(pocketSize);
      expect(rows.filter((r) => r.pageNum === 2)).toHaveLength(pocketSize);
      expect(rows.filter((r) => r.pageNum === 3)).toHaveLength(1);
    }
  });

  it('groups copies that match no binder rule as Uncategorized', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Loner', scryfallId: 'sf-loner' });
    // A binder that matches nothing leaves the copy unrouted.
    const binder = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } },
    });
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Loner', oracleId: 'o1' }),
        allocatedCopyId: 'c1',
      }),
    ];
    const groups = buildCubePullList(picks, [copy], [binder]);
    expect(groups).toEqual([
      {
        key: 'uncategorized',
        kind: 'uncategorized',
        label: 'Uncategorized',
        rows: expect.any(Array),
      },
    ]);
    expect(groups[0].rows[0]).toMatchObject({ name: 'Loner', card: copy });
  });

  it('groups every pick as Uncategorized when the user has no binders', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Loner', scryfallId: 'sf-loner' });
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Loner', oracleId: 'o1' }),
        allocatedCopyId: 'c1',
      }),
    ];
    const groups = buildCubePullList(picks, [copy], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('uncategorized');
  });

  it('groups picks with no reserved copy as Not reserved', () => {
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Ghost', oracleId: 'o1' }),
        allocatedCopyId: null,
      }),
    ];
    const groups = buildCubePullList(picks, [], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'unreserved',
      kind: 'unreserved',
      label: 'Not reserved',
    });
    expect(groups[0].rows[0]).toMatchObject({ name: 'Ghost', reason: 'not-owned' });
  });

  it('groups a pick whose reserved copy has since left the collection as Not reserved', () => {
    // allocatedCopyId points at a copy that is no longer in the collection
    // (deleted, or a reimport that hasn't remapped this binding).
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Gone', oracleId: 'o1' }),
        allocatedCopyId: 'stale-copy',
      }),
    ];
    const groups = buildCubePullList(picks, [], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('unreserved');
    expect(groups[0].rows[0]).toMatchObject({ name: 'Gone', reason: 'copy-missing' });
  });

  it('sorts Uncategorized and Not reserved rows by name, and places them at the end', () => {
    const copies = [
      makeCopy({ copyId: 'c1', name: 'Zeta', scryfallId: 'sf-z' }),
      makeCopy({ copyId: 'c2', name: 'Alpha', scryfallId: 'sf-a' }),
    ];
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Zeta', oracleId: 'o1' }),
        allocatedCopyId: 'c1',
      }),
      makePick({
        slotId: 'p2',
        card: makeCubeCard({ name: 'Alpha', oracleId: 'o2' }),
        allocatedCopyId: 'c2',
      }),
      makePick({
        slotId: 'p3',
        card: makeCubeCard({ name: 'Missing', oracleId: 'o3' }),
        allocatedCopyId: null,
      }),
    ];
    // Neither Zeta nor Alpha match "b" (empty filter DOES match everything —
    // use a rarity filter that matches neither so both fall to Uncategorized).
    const nonMatching = makeBinder({
      id: 'b',
      position: 0,
      filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } },
    });
    const groups = buildCubePullList(picks, copies, [nonMatching]);
    expect(groups.map((g) => g.kind)).toEqual(['uncategorized', 'unreserved']);
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('surfaces a copy swallowed by a binder that hides allocated cards as "out", not uncategorized', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Reserved Card', scryfallId: 'sf-r' });
    // hideDeckAllocated: false means an allocated copy this binder's rules
    // would otherwise claim is dropped from its view entirely.
    const binder = makeBinder({ id: 'b', position: 0, hideDeckAllocated: false });
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Reserved Card', oracleId: 'o1' }),
        allocatedCopyId: 'c1',
      }),
    ];
    // The FULL allocation set (as the real Binders page would pass) includes
    // this cube's own claim on c1.
    const groups = buildCubePullList(picks, [copy], [binder], {
      allocatedCopyIds: new Set(['c1']),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'out', kind: 'out' });
    expect(groups[0].rows[0]).toMatchObject({ name: 'Reserved Card', card: copy });
  });

  it('does NOT swallow the copy when allocatedCopyIds omits it (e.g. excluded on purpose)', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Reserved Card', scryfallId: 'sf-r' });
    const binder = makeBinder({ id: 'b', position: 0, hideDeckAllocated: false });
    const picks = [
      makePick({
        slotId: 'p1',
        card: makeCubeCard({ name: 'Reserved Card', oracleId: 'o1' }),
        allocatedCopyId: 'c1',
      }),
    ];
    const groups = buildCubePullList(picks, [copy], [binder]); // no allocatedCopyIds passed
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('binder');
    expect(groups[0].rows[0]).toMatchObject({ pageNum: 1, slotNum: 1 });
  });

  it('returns no groups for a cube with no picks', () => {
    expect(buildCubePullList([], [], [])).toEqual([]);
  });
});

describe('isPullableGroupKind', () => {
  it('is true only for binder and uncategorized rows', () => {
    expect(isPullableGroupKind('binder')).toBe(true);
    expect(isPullableGroupKind('uncategorized')).toBe(true);
    expect(isPullableGroupKind('out')).toBe(false);
    expect(isPullableGroupKind('unreserved')).toBe(false);
  });
});
