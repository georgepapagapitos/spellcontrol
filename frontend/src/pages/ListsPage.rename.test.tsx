// @vitest-environment happy-dom
/**
 * T157 — a list's row "Rename" menu item is a shortcut onto its own detail
 * page title (STYLE_GUIDE § Verbs — Rename), not a modal: it navigates to
 * the list and puts the title straight into edit mode.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { ListsPage } from './ListsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/lists']}>
      <Routes>
        <Route path="/collection/lists" element={<ListsPage />} />
        <Route path="/collection/lists/:id" element={<ListsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ListsPage — row Rename opens the list with its title in edit mode', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({
      cards: [],
      lists: [
        { id: 'list-1', name: 'Solo List', entries: [], order: 0, createdAt: 0, updatedAt: 0 },
      ],
    });
  });

  it('navigates to the detail page and opens the name field, no modal', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo List' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('List name')).toBeTruthy();
  });
});
