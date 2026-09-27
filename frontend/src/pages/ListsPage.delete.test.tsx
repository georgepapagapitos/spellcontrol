// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one list from /collection/lists calls the real
 * `deleteList` store action directly (no ConfirmDialog step), and the toast
 * it shows offers Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
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
