// @vitest-environment happy-dom
/**
 * Tests for:
 *   UX-317 — Decks empty state three-door layout (Build / Import / Add precon).
 *   UX-316 — "Delete all decks" lives in the hero ⋮ OverflowMenu, not the footer.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Store stubs ─────────────────────────────────────────────────────────────
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: [], deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
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

function renderEmpty() {
  // Ensure decks store is empty.
  return render(
    <MemoryRouter>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

describe('DecksIndexPage — empty state three doors (UX-317)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the "No decks yet." tagline when decks is empty', () => {
    renderEmpty();
    expect(screen.getByText('No decks yet.')).toBeTruthy();
  });

  it('renders the educational hint paragraph', () => {
    renderEmpty();
    expect(screen.getByText(/Build a deck from scratch/)).toBeTruthy();
  });

  it('has a "Build a deck" link pointing at /decks/new/guided', () => {
    renderEmpty();
    const link = screen.getByRole('link', { name: /Build a deck/ });
    expect(link.getAttribute('href')).toBe('/decks/new/guided');
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

  it('has an "Add precon" button in the empty-state area that opens the product dialog', () => {
    renderEmpty();
    const emptyActions = document.querySelector('.decks-empty-actions');
    expect(emptyActions).toBeTruthy();
    const addPreconBtn = Array.from(emptyActions!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add precon')
    );
    expect(addPreconBtn).toBeTruthy();
    fireEvent.click(addPreconBtn!);
    expect(screen.getByTestId('product-dialog')).toBeTruthy();
  });
});

describe('DecksIndexPage — "Delete all decks" in ⋮ menu (UX-316)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('does NOT render a footer "Delete all decks" button when decks is empty', () => {
    renderEmpty();
    // The old footer danger button should be gone.
    const footerLinks = Array.from(document.querySelectorAll('.decks-index-danger-btn'));
    expect(footerLinks).toHaveLength(0);
  });
});
