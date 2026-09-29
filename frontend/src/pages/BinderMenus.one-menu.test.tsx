// @vitest-environment happy-dom
/**
 * E472 — a binder has one menu. Its index tile's ⋮ (and the right-click that
 * opens it) and the ⋮ on its own page offer the same binder actions, from one
 * list (use-binder-actions.tsx). They used to be three menus on two screens:
 * "Edit binder" on the tile, "Binder rules" in the page header, Share on the
 * page only, reordering in a tab-strip ⋯ only.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sync', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/sync')>()),
  getSyncState: () => 'ready',
  hasSyncError: () => false,
  onSyncedChange: () => () => {},
}));

import { BinderPage } from './BinderPage';
import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import type { BinderDef, EnrichedCard } from '../types';

const BINDER_ACTIONS = ['Binder rules', 'Share', 'Move up', 'Move down', 'Delete binder'];

function binder(id: string, name: string, position: number): BinderDef {
  return {
    id,
    name,
    position,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
  } as BinderDef;
}

const card = {
  copyId: 'c1',
  scryfallId: 's1',
  oracleId: 'o1',
  name: 'Sol Ring',
  setCode: 'CMR',
  collectorNumber: '1',
  rarity: 'uncommon',
  purchasePrice: 1,
  finish: 'nonfoil',
} as unknown as EnrichedCard;

beforeEach(() => {
  useAuth.setState({ status: 'guest' });
  useCollectionStore.setState({
    hydrating: false,
    cards: [card],
    binders: [binder('b-first', 'First', 0), binder('b-second', 'Second', 1)],
    activeTab: 'b-second',
  });
});

/** Every binder action a user can reach, as a menu item or a header button. */
function reachable(labels: string[]) {
  const names = new Set([
    ...screen.queryAllByRole('menuitem').map((el) => el.textContent?.trim() ?? ''),
    ...screen
      .queryAllByRole('button')
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''),
  ]);
  return labels.filter((l) => names.has(l));
}

describe('a binder has one menu (E472)', () => {
  it('offers the same actions from its index tile and from its own page', () => {
    render(
      <MemoryRouter initialEntries={['/collection/binders']}>
        <BindersIndexPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second' }));
    expect(reachable(BINDER_ACTIONS)).toEqual(BINDER_ACTIONS);
    cleanup();

    render(
      <MemoryRouter initialEntries={['/collection/binders/b-second']}>
        <Routes>
          <Route path="/collection/binders/:id" element={<BinderPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    expect(reachable(BINDER_ACTIONS)).toEqual(BINDER_ACTIONS);
    // The tab strip no longer carries a second, different menu.
    expect(screen.queryByRole('button', { name: 'Binder actions' })).toBeNull();
    // The retired name for the editor is gone from both.
    expect(screen.queryByRole('menuitem', { name: 'Edit binder' })).toBeNull();
  });
});
