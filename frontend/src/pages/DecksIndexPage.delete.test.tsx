// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one deck from the /decks index calls `deleteDeck`
 * directly (no ConfirmDialog step) and the toast it shows offers Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDeleteDeck = vi.fn();
let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: {
      decks: unknown[];
      deleteDeck: typeof mockDeleteDeck;
      deleteDecks: () => void;
      deleteAllDecks: () => void;
    }) => unknown
  ) =>
    sel({
      decks: mockDecks,
      deleteDeck: mockDeleteDeck,
      deleteDecks: vi.fn(),
      deleteAllDecks: vi.fn(),
    }),
}));

vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));

// Keep the page light — mirrors DecksIndexPage.value.test.tsx's stub set.
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('@/components/import/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('@/components/share/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('@/components/decks/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('@/lib/deck/deck-validation', () => ({
  effectiveDeckColors: () => [],
  deckDisplayColors: () => [],
  validateDeckZones: () => ({ deck: [], sideboardOnly: [] }),
  countFlaggedCards: () => 0,
}));
vi.mock('../deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
}));

import { DecksIndexPage } from './DecksIndexPage';

function makeDeck(id: string, name: string) {
  return {
    id,
    name,
    commander: undefined,
    cards: [],
    sideboard: [],
    color: '#888',
    format: 'commander',
    source: 'manual',
    updatedAt: 0,
  };
}

describe('DecksIndexPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDeleteDeck.mockClear();
    mockDecks = [makeDeck('deck-1', 'Solo Deck')];
  });

  it('calls deleteDeck directly from the row menu, with no confirm dialog', () => {
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo Deck' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(mockDeleteDeck).toHaveBeenCalledWith('deck-1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('DecksIndexPage — right-click on a deck tile (T162)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDeleteDeck.mockClear();
    mockDecks = [makeDeck('deck-1', 'Solo Deck')];
  });

  it('opens the tile’s own menu, with Open in new tab and Copy link above Delete', () => {
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    const tile = screen.getByRole('link', { name: /Solo Deck/ });
    // Prevented: the right-click on the deck's own link is ours, since the
    // menu carries what the browser's link menu offered.
    expect(fireEvent.contextMenu(tile, { clientX: 40, clientY: 60 })).toBe(false);
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels.slice(-3)).toEqual(['Open in new tab', 'Copy link', 'Delete']);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(mockDeleteDeck).toHaveBeenCalledWith('deck-1');
  });
});
