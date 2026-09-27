// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one list from /collection/lists calls the real
 * `deleteList` store action directly (no ConfirmDialog step), and the toast
 * it shows offers Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { ListsPage } from './ListsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/lists']}>
      <ListsPage />
    </MemoryRouter>
  );
}

describe('ListsPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({
      cards: [],
      lists: [
        {
          id: 'list-1',
          name: 'Solo List',
          entries: [],
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
  });

  it('calls deleteList directly from the row menu, with no confirm dialog, and toasts Undo', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo List' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(useCollectionStore.getState().lists).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo List');
  });
});

describe('ListsPage — "Delete all lists" lives in the header ⋮', () => {
  const list = (id: string, name: string, order: number) => ({
    id,
    name,
    entries: [],
    order,
    createdAt: 0,
    updatedAt: 0,
  });

  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
  });

  it('is not offered with a single list, which deletes from its own row', () => {
    useCollectionStore.setState({ cards: [], lists: [list('list-1', 'Solo List', 0)] });
    renderPage();
    // At desktop width the one secondary action sits inline, so with the
    // delete-all withheld the ⋮ has nothing to hold and does not render.
    expect(screen.queryByRole('button', { name: 'More list actions' })).toBeNull();
    expect(screen.queryByText('Delete all lists')).toBeNull();
  });

  it('is the last ⋮ item, never a link under the list, and confirms before deleting', async () => {
    useCollectionStore.setState({
      cards: [],
      lists: [list('list-1', 'One', 0), list('list-2', 'Two', 1)],
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Delete all lists' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More list actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1].textContent).toBe('Delete all lists');
    fireEvent.click(items[items.length - 1]);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useCollectionStore.getState().lists).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all lists' }));
    await waitFor(() => expect(useCollectionStore.getState().lists).toHaveLength(0));
  });
});
