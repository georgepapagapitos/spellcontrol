// @vitest-environment happy-dom
/**
 * CB-09 — a list's meta line counts "cards" for every list kind (dynamic lists
 * already did), and a tracking list says what that means instead of a bare
 * "tracking".
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { ListsPage } from './ListsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';

describe('ListsPage — meta line wording', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({
      cards: [],
      lists: [
        { id: 'a', name: 'Wants', entries: [], order: 0, createdAt: 0, updatedAt: 0 },
        {
          id: 'b',
          name: 'Owned set',
          kind: 'tracking',
          entries: [],
          order: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
  });

  it('says cards, never entries, and spells out a tracking list', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/collection/lists']}>
        <Routes>
          <Route path="/collection/lists" element={<ListsPage />} />
        </Routes>
      </MemoryRouter>
    );
    const metas = [...container.querySelectorAll('.binders-index-card-cards')].map(
      (n) => n.textContent
    );
    expect(metas).toContain('0 cards');
    expect(metas).toContain('0 cards · tracking what you own');
    expect(screen.queryByText(/entries/)).toBeNull();
  });
});
