// @vitest-environment happy-dom
/**
 * <BinderEditor/> is mounted in the Layout on every signed-in route. While it
 * is CLOSED it must do no collection-sized work: the ungated landing-count memo
 * materialised every binder (a full ~11.5k-card sort per binder) on every page
 * load — the largest single memo in the deck editor's 2.3 s long task (E276).
 * Pair of BinderEditor.catalogs.test.tsx, which pins the same rule for the
 * Scryfall catalog fetch.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '@/store/collection';
import { BinderEditor } from './BinderEditor';

const countEffectiveLanding = vi.hoisted(() =>
  vi.fn(() => ({
    matches: 1,
    lands: 1,
    caughtAbove: 0,
    pulledIn: 0,
    caughtBy: [],
    ladder: [],
    draftId: '__draft__',
  }))
);
const countBinderMatches = vi.hoisted(() => vi.fn(() => ({ total: 1, perGroup: [1] })));
const materializeDraftPreview = vi.hoisted(() =>
  vi.fn(() => ({
    def: { id: '__draft__', name: '', color: '#888' },
    effectivePocketSize: 9,
    effectiveSorts: [],
    displaySorts: [],
    sections: [],
    totalCards: 0,
    totalPages: 0,
    totalValue: 0,
  }))
);
vi.mock('@/lib/binder/binder-counts', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/binder/binder-counts')>()),
  countEffectiveLanding,
  countBinderMatches,
  materializeDraftPreview,
}));

describe('BinderEditor while closed', () => {
  beforeEach(() => {
    countEffectiveLanding.mockClear();
    countBinderMatches.mockClear();
    useCollectionStore.setState({
      editingBinder: null,
      editingBinderSeed: null,
      binders: [],
      cards: [],
    });
  });

  it('materialises nothing while closed, and counts the landing once it opens', async () => {
    render(<BinderEditor />);
    expect(countEffectiveLanding).not.toHaveBeenCalled();
    expect(countBinderMatches).not.toHaveBeenCalled();

    const now = Date.now();
    await act(async () => {
      useCollectionStore.setState({
        binders: [
          {
            id: 'b1',
            name: 'Elves',
            position: 0,
            filterGroups: [{ filter: {} }],
            sorts: [],
            pocketSize: 9,
            doubleSided: false,
            fixedCapacity: null,
            color: '#888',
            createdAt: now,
            updatedAt: now,
          },
        ],
        editingBinder: 'b1',
      });
    });
    expect(countEffectiveLanding).toHaveBeenCalled();
  });
});
