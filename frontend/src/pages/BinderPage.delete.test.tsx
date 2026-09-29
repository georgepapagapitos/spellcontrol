// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting the binder you're looking at from its own ⋮ menu
 * calls the real `deleteBinder` store action directly (no ConfirmDialog
 * step); the page's existing "route points at a binder that doesn't exist"
 * redirect then reactively bounces to the index, and the toast survives that
 * navigation (the toast store is global, not page state) offering Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

const syncMock = { state: 'ready' as 'idle' | 'syncing' | 'ready', error: false };
import { vi } from 'vitest';
vi.mock('@/lib/sync', () => ({
  getSyncState: () => syncMock.state,
  hasSyncError: () => syncMock.error,
  onSyncedChange: () => () => {},
}));

import { BinderPage } from './BinderPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';
import type { BinderDef, EnrichedCard } from '../types';

function makeBinder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'binder-1',
    name: 'Solo Binder',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as BinderDef;
}

function makeCard(
  over: Partial<EnrichedCard> & { copyId: string; scryfallId: string }
): EnrichedCard {
  return {
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    ...over,
  } as EnrichedCard;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/binders/binder-1']}>
      <Routes>
        <Route path="/collection/binders" element={<div>BINDER INDEX</div>} />
        <Route path="/collection/binders/:id" element={<BinderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('BinderPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    syncMock.state = 'ready';
    syncMock.error = false;
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({
      hydrating: false,
      cards: [makeCard({ copyId: 'c1', scryfallId: 's1' })],
      binders: [makeBinder()],
      activeTab: 'binder-1',
    });
  });

  it('calls deleteBinder directly from the ⋮ menu, with no confirm dialog, and toasts Undo with the consequence', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete binder' }));

    expect(useCollectionStore.getState().binders).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo Binder and moved its cards to other binders');

    // The binder no longer exists, so the page's own stale-route guard sends
    // the user back to the index — Undo still restores the binder into the
    // store the user lands on.
    expect(screen.getByText('BINDER INDEX')).toBeTruthy();
    toast!.onAction!();
    expect(useCollectionStore.getState().binders.map((b) => b.id)).toEqual(['binder-1']);
  });
});
