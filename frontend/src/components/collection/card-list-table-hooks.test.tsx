// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCollectionStore } from '@/store/collection';
import { useToastsStore } from '@/store/toasts';
import { printingFinishKey } from '@/lib/collection/collection-mutations';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { EnrichedCard } from '@/types/index';
import { useRowSelection } from './card-list-table-selection';
import { useCollectionRowActions } from './card-list-table-actions';
import { useGroupedRows } from './card-list-table-layout';
import { useAllocationsFor } from './card-list-table-hooks';
import { buildRows } from './card-list-table-derive';
import type { GroupKey, Row } from './card-list-table-config';

function card(copyId: string, scryfallId: string, name: string, rarity = 'rare'): EnrichedCard {
  return {
    copyId,
    scryfallId,
    oracleId: `o-${scryfallId}`,
    name,
    typeLine: 'Creature',
    colorIdentity: [],
    rarity,
    setCode: 'tst',
    collectorNumber: '1',
    foil: false,
  } as unknown as EnrichedCard;
}

function row(key: string, c: EnrichedCard, qty = 1): Row {
  return { key, card: c, qty, binderId: null, binderName: null, binderColor: null, binders: [] };
}

afterEach(cleanup);

describe('useRowSelection', () => {
  const rows = [row('a', card('c1', 's1', 'Alpha'), 3), row('b', card('c2', 's2', 'Beta'), 1)];

  it('toggles rows and counts rows and copies for the label', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    expect(result.current.countLabel).toBe('0 rows · 0 copies');
    act(() => result.current.toggleRow('a'));
    expect(result.current.countLabel).toBe('1 row · 3 copies');
    act(() => result.current.toggleRow('b'));
    expect(result.current.countLabel).toBe('2 rows · 4 copies');
    act(() => result.current.toggleRow('a'));
    expect(result.current.countLabel).toBe('1 row · 1 copy');
  });

  it('select all covers the shown rows and flips allSelected', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.selectAll());
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.clearSelection());
    expect(result.current.allSelected).toBe(false);
  });

  it('is never "all selected" over an empty list', () => {
    const { result } = renderHook(() => useRowSelection([]));
    expect(result.current.allSelected).toBe(false);
  });

  it('leaving select mode clears the selection', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    act(() => {
      result.current.setSelectMode(true);
      result.current.toggleRow('a');
    });
    expect(result.current.selectMode).toBe(true);
    act(() => result.current.exitSelectMode());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selectedRowKeys.size).toBe(0);
  });
});

describe('useGroupedRows', () => {
  const rare = row('r', card('c1', 's1', 'Alpha', 'rare'));
  const common = row('c', card('c2', 's2', 'Beta', 'common'));

  beforeEach(() => localStorage.clear());

  it('passes rows through ungrouped, with no headers', () => {
    const { result } = renderHook(() => useGroupedRows([rare, common], 'none', undefined));
    expect(result.current.displayRows).toEqual([rare, common]);
    expect(result.current.sectionHeaders).toBeNull();
    expect(result.current.allSectionKeys).toEqual([]);
    expect(result.current.allCollapsed).toBe(false);
  });

  it('folds one section, then all, and persists per grouping field', () => {
    const { result } = renderHook(() => useGroupedRows([rare, common], 'rarity', undefined));
    const keys = result.current.allSectionKeys;
    expect(keys).toHaveLength(2);
    act(() => result.current.toggleCollapsed(keys[0]));
    expect(result.current.collapsedKeys.has(keys[0])).toBe(true);
    expect(result.current.allCollapsed).toBe(false);
    expect(
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.includes('rarity')) ?? 'missing'
        ) ?? '[]'
      )
    ).toEqual([keys[0]]);
    act(() => result.current.toggleAllCollapsed());
    expect(result.current.allCollapsed).toBe(true);
    act(() => result.current.toggleAllCollapsed());
    expect(result.current.collapsedKeys.size).toBe(0);
  });

  it('re-reads the fold state of the new field when the grouping changes', () => {
    const first = renderHook(() => useGroupedRows([rare, common], 'rarity', undefined));
    const key = first.result.current.allSectionKeys[0];
    act(() => first.result.current.toggleCollapsed(key));
    first.unmount();

    const { result, rerender } = renderHook(
      ({ g }: { g: GroupKey }) => useGroupedRows([rare, common], g, undefined),
      { initialProps: { g: 'none' as GroupKey } }
    );
    expect(result.current.collapsedKeys.size).toBe(0);
    rerender({ g: 'rarity' });
    expect([...result.current.collapsedKeys]).toEqual([key]);
    rerender({ g: 'none' });
    expect(result.current.collapsedKeys.size).toBe(0);
  });
});

describe('useCollectionRowActions', () => {
  const a1 = card('c1', 's1', 'Alpha');
  const a2 = card('c2', 's1', 'Alpha');
  const b1 = card('c3', 's2', 'Beta');
  const all = [a1, a2, b1];

  beforeEach(() => {
    useCollectionStore.setState({ cards: all });
    useToastsStore.setState({ toasts: [] });
  });

  function setup(opts: { groupPrintings: boolean; selected: string[] }) {
    return renderHook(() =>
      useCollectionRowActions({
        cards: all,
        allCards: useCollectionStore((s) => s.cards),
        allocations: new Map<string, AllocationInfo>(),
        groupPrintings: opts.groupPrintings,
        selectedRowKeys: new Set(opts.selected),
        clearSelection: () => {},
      })
    );
  }

  it('expands a grouped row key to every copy of the printing', () => {
    const { result } = setup({ groupPrintings: true, selected: [printingFinishKey(a1)] });
    expect(result.current.selectedCopyIds().sort()).toEqual(['c1', 'c2']);
  });

  it('treats ungrouped row keys as copy ids', () => {
    const { result } = setup({ groupPrintings: false, selected: ['c1', 'c3'] });
    expect(result.current.selectedCopyIds().sort()).toEqual(['c1', 'c3']);
  });

  it('removes a lone copy straight away and Undo restores it', () => {
    const { result } = setup({ groupPrintings: true, selected: [] });
    act(() => result.current.handleDeleteRow(row('b', b1)));
    expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['c1', 'c2']);
    const toast = useToastsStore.getState().toasts[0];
    expect(toast.message).toBe('Removed 1 copy of Beta');
    act(() => {
      toast.onAction?.();
    });
    expect(
      useCollectionStore
        .getState()
        .cards.map((c) => c.copyId)
        .sort()
    ).toEqual(['c1', 'c2', 'c3']);
  });

  it('asks how many to drop when a printing has several copies', () => {
    const { result } = setup({ groupPrintings: true, selected: [] });
    act(() => result.current.handleDeleteRow(row('a', a1, 2)));
    expect(result.current.deletingRow?.total).toBe(2);
    expect(useCollectionStore.getState().cards).toHaveLength(3);
    act(() => result.current.confirmDeleteCount(1));
    expect(useCollectionStore.getState().cards).toHaveLength(2);
    expect(result.current.deletingRow).toBeNull();
  });

  it('removes exactly the one copy in ungrouped view', () => {
    const { result } = setup({ groupPrintings: false, selected: [] });
    act(() => result.current.handleDeleteRow(row('c1', a1)));
    expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['c2', 'c3']);
  });

  it('offers the three bulk actions', () => {
    const { result } = setup({ groupPrintings: false, selected: ['c1'] });
    expect(result.current.bulkActions.map((x) => x.label)).toEqual([
      'Move to…',
      'Mark as proxy',
      'Delete selected',
    ]);
  });
});

describe('useAllocationsFor', () => {
  const inDeck = { ownerKind: 'deck', ownerId: 'd1', ownerName: 'Burn' } as AllocationInfo;

  it('keys a grouped stack by finish, the same key the rows group by', () => {
    // An etched copy is foil: true with finish 'etched'. Keyed by foil alone it
    // shared a bucket with the foil row of the same printing, so the foil tile
    // wore the etched copy's deck mark.
    const etched = { ...card('e1', 'p1', 'Bolt'), foil: true, finish: 'etched' } as EnrichedCard;
    const foil = { ...card('f1', 'p1', 'Bolt'), foil: true, finish: 'foil' } as EnrichedCard;
    const allCards = [etched, foil];
    const rows = buildRows(allCards, new Map(), true);
    expect(rows).toHaveLength(2);
    const { result } = renderHook(() =>
      useAllocationsFor(true, allCards, new Map([['e1', inDeck]]))
    );
    const byCopy = Object.fromEntries(rows.map((r) => [r.card.copyId, result.current(r.card)]));
    expect(byCopy.e1).toEqual([inDeck]);
    expect(byCopy.f1).toEqual([]);
  });
});
