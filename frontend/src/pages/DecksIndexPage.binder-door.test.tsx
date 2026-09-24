// @vitest-environment happy-dom
/**
 * The "From my binder" door in the Decks hero: a link into the new-deck
 * commander picker, opened on the tab that ranks every owned commander by how
 * much of its deck the collection already covers. It replaced the readiness
 * spotlight strip, and shares the tab's own gate — below MIN_COLLECTION_SIZE
 * the ranking has nothing to say, so the door stays hidden.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_COLLECTION_SIZE } from '../lib/commander-readiness';

let mockCards: unknown[] = [];
vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) =>
    sel({ cards: mockCards, binders: [], hydrating: false }),
}));
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: [], deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../components/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('../lib/deck-validation', () => ({
  effectiveDeckColors: () => [],
  deckColorFrequency: () => [],
  validateDeck: () => ({ errors: [] }),
  countFlaggedCards: () => 0,
}));
vi.mock('../deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
}));

import { DecksIndexPage } from './DecksIndexPage';

function cards(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ copyId: `c${i}`, name: `Card ${i}` }));
}

function NewDeckProbe() {
  const { state } = useLocation();
  return <p>new deck picker, source {(state as { commanderSource?: string })?.commanderSource}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/decks']}>
      <Routes>
        <Route path="/decks" element={<DecksIndexPage />} />
        <Route path="/decks/new" element={<NewDeckProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function openDeckMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More ways to start a deck' }));
}

// The door is one of the header's secondary actions, so it lives in the ⋮
// menu (PageHeader keeps one secondary inline; that one is Import deck).
describe('DecksIndexPage — "From my binder" door', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('opens the new-deck picker on the binder tab once the collection is big enough', () => {
    mockCards = cards(MIN_COLLECTION_SIZE);
    renderPage();
    openDeckMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New deck from my binder/ }));
    expect(screen.getByText('new deck picker, source binder')).toBeTruthy();
  });

  it('stays hidden while the collection is too small for the ranking to say anything', () => {
    mockCards = cards(MIN_COLLECTION_SIZE - 1);
    renderPage();
    openDeckMenu();
    expect(screen.queryByRole('menuitem', { name: /from my binder/i })).toBeNull();
  });
});
