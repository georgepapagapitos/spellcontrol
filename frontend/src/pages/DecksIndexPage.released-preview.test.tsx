// @vitest-environment happy-dom
/**
 * The decks index counts flagged cards the way the deck page does. A Star Trek
 * Commander (TRC) card added during preview week stores not_legal and keeps it
 * after release (2026-11-13); once the server calls it legal, the deck's row
 * shows no flagged-cards marker.
 */
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: mockDecks, deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('@/components/import/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('@/components/share/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('@/components/overlays/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/decks/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));

const lookup = vi.hoisted(() => vi.fn());
vi.mock('../deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
  getCurrentCardsByName: lookup,
}));

import { DecksIndexPage } from './DecksIndexPage';

const DEFIANT = 'U.S.S. Defiant, Tough Little Ship';

function trekDeck() {
  return {
    id: 'trek',
    name: 'Trek Deck',
    commander: {
      name: 'Jean-Luc Picard, Luminary',
      type_line: 'Legendary Creature',
      legalities: { commander: 'legal' },
    },
    // The stored preview copy, as the deck holds it.
    cards: [
      {
        slotId: 's1',
        card: {
          name: DEFIANT,
          type_line: 'Legendary Artifact',
          released_at: '2026-11-13',
          legalities: { commander: 'not_legal' },
        },
      },
    ],
    sideboard: [],
    color: '#888',
    format: 'commander',
    source: 'manual',
    updatedAt: 0,
  };
}

function renderIndex() {
  return render(
    <MemoryRouter>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

describe('DecksIndexPage: a card stored as a preview, after release', () => {
  beforeEach(() => {
    localStorage.clear();
    lookup.mockReset();
    mockDecks = [trekDeck()];
  });

  it('is not counted as flagged once the server calls it legal', async () => {
    lookup.mockResolvedValue(
      new Map([[DEFIANT, { name: DEFIANT, legalities: { commander: 'legal' } }]])
    );
    renderIndex();
    await waitFor(() => expect(lookup).toHaveBeenCalledWith([DEFIANT]));
    await waitFor(() => expect(screen.queryByLabelText('1 card flagged')).toBeNull());
  });

  it('stays flagged when the server still calls it not legal', async () => {
    lookup.mockResolvedValue(
      new Map([[DEFIANT, { name: DEFIANT, legalities: { commander: 'not_legal' } }]])
    );
    renderIndex();
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(screen.getByLabelText('1 card flagged')).toBeTruthy();
  });
});
