// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one binder from /collection/binders calls the
 * real `deleteBinder` store action directly (no ConfirmDialog step), and the
 * toast it shows offers Undo and carries the "cards move elsewhere"
 * consequence the confirm dialog used to state.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';
import type { BinderDef } from '../types';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/binders']}>
      <BindersIndexPage />
    </MemoryRouter>
  );
}

describe('BindersIndexPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({
      cards: [],
      binders: [makeBinder()],
      activeTab: 'binder-1',
    });
  });

  it('calls deleteBinder directly from the row menu, with no confirm dialog, and toasts Undo with the consequence', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo Binder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete binder' }));

    expect(useCollectionStore.getState().binders).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo Binder and moved its cards to other binders');
  });
});

describe('BindersIndexPage — "Delete all binders" lives in the header ⋮', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
  });

  it('is not offered with a single binder, which deletes from its own card', () => {
    useCollectionStore.setState({ cards: [], binders: [makeBinder()], activeTab: 'binder-1' });
    renderPage();
    // At desktop width the one secondary action sits inline, so with the
    // delete-all withheld the ⋮ has nothing to hold and does not render.
    expect(screen.queryByRole('button', { name: 'More binder actions' })).toBeNull();
    expect(screen.queryByText('Delete all binders')).toBeNull();
  });

  it('is the last ⋮ item, never a link under the list, and confirms before deleting', async () => {
    useCollectionStore.setState({
      cards: [],
      binders: [makeBinder(), makeBinder({ id: 'binder-2', name: 'Second', position: 1 })],
      activeTab: 'binder-1',
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Delete all binders' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1].textContent).toBe('Delete all binders');
    fireEvent.click(items[items.length - 1]);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useCollectionStore.getState().binders).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all binders' }));
    await waitFor(() => expect(useCollectionStore.getState().binders).toHaveLength(0));
  });
});
