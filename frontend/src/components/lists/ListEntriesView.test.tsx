// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ListEntriesView } from './ListEntriesView';
import { useCollectionStore } from '@/store/collection';
import type { ListDef } from '@/types/index';

const list: ListDef = {
  id: 'list-1',
  name: 'Wishlist',
  entries: [],
  order: 0,
  createdAt: 0,
  updatedAt: 0,
};

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ListEntriesView list={list} />
    </MemoryRouter>
  );
}

describe('ListEntriesView — rename (STYLE_GUIDE § Verbs — Rename)', () => {
  beforeEach(() => {
    useCollectionStore.setState({ cards: [], lists: [list] });
  });

  it('renames in place on the title: Enter saves via the real store action', async () => {
    renderAt('/collection/lists/list-1');

    fireEvent.click(screen.getByRole('button', { name: 'Rename Wishlist' }));
    const input = screen.getByLabelText('List name');
    fireEvent.change(input, { target: { value: 'Trade pile' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(useCollectionStore.getState().lists.find((l) => l.id === 'list-1')?.name).toBe(
        'Trade pile'
      )
    );
  });

  it('Escape reverts without renaming', () => {
    renderAt('/collection/lists/list-1');

    fireEvent.click(screen.getByRole('button', { name: 'Rename Wishlist' }));
    const input = screen.getByLabelText('List name');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(useCollectionStore.getState().lists.find((l) => l.id === 'list-1')?.name).toBe(
      'Wishlist'
    );
    expect(screen.getByRole('button', { name: 'Rename Wishlist' }).textContent).toContain(
      'Wishlist'
    );
  });

  it('a rename hand-off from the index (autoRename) opens the title straight into edit mode', () => {
    renderAt({ pathname: '/collection/lists/list-1', state: { autoRename: true } });

    expect(screen.getByLabelText('List name')).toBeTruthy();
  });
});
