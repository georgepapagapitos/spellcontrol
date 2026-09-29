// @vitest-environment happy-dom
/**
 * Tests for:
 *   UX-317 — Decks empty state three-door layout (Build / Import / Add precon).
 *   "Delete all decks" is the last, danger item in the header ⋮ (like
 *   Collection, Binders and Lists), offered only when there is more than one deck.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Store stubs ─────────────────────────────────────────────────────────────
// Mutable so individual tests can supply decks before rendering.
const mockDeleteAllDecks = vi.fn();
let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: mockDecks, deleteDeck: vi.fn(), deleteAllDecks: mockDeleteAllDecks }),
}));

// ── Heavy component stubs ───────────────────────────────────────────────────
vi.mock('../components/deck/ImportDeckDialog', () => ({
  ImportDeckDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('../components/ProductSearchDialog', () => ({
  ProductSearchDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="product-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({
    title,
    onConfirm,
    onCancel,
  }: {
    title: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog">
      <p>{title}</p>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));
vi.mock('../components/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
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

function renderEmpty() {
  // Ensure decks store is empty.
  return render(
    <MemoryRouter>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

function makeDeck(id: string, name: string) {
  return {
    id,
    name,
    cards: [],
    sideboard: [],
    color: '#888',
    format: 'commander',
    source: 'manual',
    updatedAt: 0,
  };
}

describe('DecksIndexPage — empty state three doors (UX-317)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDecks = [];
    mockDeleteAllDecks.mockClear();
  });
  afterEach(() => localStorage.clear());

  it('shows the "No decks yet." tagline when decks is empty', () => {
    renderEmpty();
    expect(screen.getByText('No decks yet.')).toBeTruthy();
  });

  it('renders the educational hint paragraph', () => {
    renderEmpty();
    expect(screen.getByText(/Build one, or bring in a list or precon/)).toBeTruthy();
  });

  it('has a "Build a deck" link pointing at /decks/new', () => {
    renderEmpty();
    const link = screen.getByRole('link', { name: /Build a deck/ });
    expect(link.getAttribute('href')).toBe('/decks/new');
  });

  it('has an "Import deck" button in the empty-state area that opens the import dialog', () => {
    renderEmpty();
    // Both the hero ⋮ menu and the empty-state actions have "Import deck" buttons.
    // Target the one inside .decks-empty-actions.
    const emptyActions = document.querySelector('.decks-empty-actions');
    expect(emptyActions).toBeTruthy();
    // Target the Import deck button inside the empty-state actions group.
    const importBtn = Array.from(emptyActions!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Import deck')
    );
    expect(importBtn).toBeTruthy();
    fireEvent.click(importBtn!);
    expect(screen.getByTestId('import-dialog')).toBeTruthy();
  });

  it('has an "Add a product" button in the empty-state area that opens the product dialog', () => {
    renderEmpty();
    const emptyActions = document.querySelector('.decks-empty-actions');
    expect(emptyActions).toBeTruthy();
    const addPreconBtn = Array.from(emptyActions!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add a product')
    );
    expect(addPreconBtn).toBeTruthy();
    fireEvent.click(addPreconBtn!);
    expect(screen.getByTestId('product-dialog')).toBeTruthy();
  });
});

describe('DecksIndexPage — seeded search (?query=, from the Home hero)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDecks = [];
    mockDeleteAllDecks.mockClear();
  });
  afterEach(() => localStorage.clear());

  it('seeds the search box from ?query= on mount', () => {
    mockDecks = [makeDeck('a', 'Atraxa Superfriends'), makeDeck('b', 'Other Deck')];
    render(
      <MemoryRouter initialEntries={['/decks?query=Atraxa']}>
        <DecksIndexPage />
      </MemoryRouter>
    );
    const input = screen.getByRole('textbox', { name: 'Search decks' }) as HTMLInputElement;
    expect(input.value).toBe('Atraxa');
  });

  it('defaults to an empty search with no ?query= param', () => {
    mockDecks = [makeDeck('a', 'Atraxa Superfriends')];
    renderEmpty();
    const input = screen.getByRole('textbox', { name: 'Search decks' }) as HTMLInputElement;
    expect(input.value).toBe('');
  });
});

describe('DecksIndexPage — "Delete all decks" in the header ⋮', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDecks = [];
    mockDeleteAllDecks.mockClear();
  });
  afterEach(() => localStorage.clear());

  function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'More deck actions' }));
  }

  it('is not offered when there are no decks', () => {
    renderEmpty();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Delete all decks' })).toBeNull();
  });

  it('is not offered with a single deck, which deletes from its own card', () => {
    mockDecks = [makeDeck('a', 'Solo')];
    renderEmpty();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Delete all decks' })).toBeNull();
  });

  it('is the last menu item, never a link under the list, and confirms before deleting', () => {
    mockDecks = [makeDeck('a', 'One'), makeDeck('b', 'Two')];
    renderEmpty();
    expect(screen.queryByRole('button', { name: 'Delete all decks' })).toBeNull();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1].textContent).toBe('Delete all decks');
    fireEvent.click(items[items.length - 1]);
    // Confirm dialog appears; not deleted until confirmed.
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(mockDeleteAllDecks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm'));
    expect(mockDeleteAllDecks).toHaveBeenCalledTimes(1);
  });
});
