// @vitest-environment happy-dom
/**
 * The "From my binder" door in the Decks hero: a link into the new-deck
 * commander picker, opened on the tab that ranks every owned commander by how
 * much of its deck the collection already covers. It replaced the readiness
 * spotlight strip, and shares the tab's own gate — below MIN_COLLECTION_SIZE
 * the ranking has nothing to say, so the door stays hidden.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

describe('DecksIndexPage — "From my binder" door', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('links into the new-deck picker on the binder tab once the collection is big enough', () => {
    mockCards = cards(MIN_COLLECTION_SIZE);
    renderPage();
    const link = screen.getByRole('link', { name: /From my binder/ });
    expect(link.getAttribute('href')).toBe('/decks/new');
  });

  it('stays hidden while the collection is too small for the ranking to say anything', () => {
    mockCards = cards(MIN_COLLECTION_SIZE - 1);
    renderPage();
    expect(screen.queryByRole('link', { name: /From my binder/ })).toBeNull();
  });
});
