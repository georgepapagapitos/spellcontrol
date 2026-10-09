// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBinderActions } from './use-binder-actions';
import { useCollectionStore } from '@/store/collection';
import { useToastsStore } from '@/store/toasts';
import type { BinderDef, EnrichedCard } from '@/types/index';

const rare = {
  copyId: 'c-rare',
  scryfallId: 'sf-rare',
  oracleId: 'o-rare',
  name: 'Smothering Tithe',
  typeLine: 'Enchantment',
  colorIdentity: ['W'],
  rarity: 'rare',
  purchasePrice: 18,
  setCode: 'tst',
  collectorNumber: '1',
} as unknown as EnrichedCard;

function binder(id: string, position: number, filter: BinderDef['filterGroups'][0]['filter']) {
  return {
    id,
    name: id,
    position,
    filterGroups: [{ filter }],
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: 0,
    updatedAt: 0,
  } as BinderDef;
}

const white = binder('White', 0, { colorIdentity: { colors: ['W'], mode: 'all' } });
const rares = binder('Rares', 1, {
  rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] },
});

beforeEach(() => {
  useCollectionStore.setState({ cards: [rare], binders: [white, rares] });
  useToastsStore.setState({ toasts: [] });
});

describe('useBinderActions', () => {
  it('is one list, in one order, with the editor named the way UX-305 named it', () => {
    const { result } = renderHook(() => useBinderActions());
    const labels = result.current.actionsFor(white, { onShare: () => {} }).map((a) => a.label);
    expect(labels).toEqual(['Binder rules', 'Share', 'Move up', 'Move down', 'Delete binder']);
  });

  it('greys out the moves a binder at either end cannot make', () => {
    const { result } = renderHook(() => useBinderActions());
    const byLabel = (def: BinderDef) =>
      Object.fromEntries(
        result.current.actionsFor(def, { onShare: () => {} }).map((a) => [a.label, a])
      );
    expect(byLabel(white)['Move up'].disabled).toBe(true);
    expect(byLabel(white)['Move down'].disabled).toBe(false);
    expect(byLabel(rares)['Move down'].disabled).toBe(true);
  });

  it('leaves reordering out where the list is not in priority order', () => {
    const { result } = renderHook(() => useBinderActions());
    const labels = result.current
      .actionsFor(white, { onShare: () => {}, canReorder: false })
      .map((a) => a.label);
    expect(labels).toEqual(['Binder rules', 'Share', 'Delete binder']);
  });

  it('marks which actions may stand as a page-header button', () => {
    const { result } = renderHook(() => useBinderActions());
    const standing = result.current
      .actionsFor(white, { onShare: () => {} })
      .filter((a) => a.canStandAlone)
      .map((a) => a.label);
    expect(standing).toEqual(['Binder rules', 'Share']);
  });

  // The tab strip's ⋯ reordered silently; the index toasted. One move, one
  // behavior, wherever it is made.
  it('says how many cards a move sent to another binder', () => {
    const { result } = renderHook(() => useBinderActions());
    const moveDown = result.current
      .actionsFor(white, { onShare: () => {} })
      .find((a) => a.label === 'Move down')!;
    act(() => moveDown.onClick());
    expect(useCollectionStore.getState().binders.find((b) => b.id === 'Rares')?.position).toBe(0);
    expect(useToastsStore.getState().toasts.at(-1)?.message).toBe(
      'Reorder moved 1 card between binders'
    );
  });
});
