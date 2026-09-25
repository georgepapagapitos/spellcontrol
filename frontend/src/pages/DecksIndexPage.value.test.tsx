// @vitest-environment happy-dom
/**
 * The decks index prints each deck's value, the number its Value sort orders
 * by. Before this the list could be sorted by Value with no value on screen.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrencyStore } from '../lib/currency';

// ── Store stubs ─────────────────────────────────────────────────────────────
let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: mockDecks, deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));

vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));

// ── Heavy component stubs (mirrors DecksIndexPage.publicbadge.test.tsx) ─────
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../components/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('../lib/deck-validation', () => ({
  effectiveDeckColors: () => [],
  deckColorFrequency: () => [],
  validateDeckZones: () => ({ deck: [], sideboardOnly: [] }),
  countFlaggedCards: () => 0,
}));
vi.mock('../deck-builder/services/scryfall/client', () => ({
  getCardPrice: (c: { prices?: { usd?: string; eur?: string } }, currency: 'USD' | 'EUR') =>
    (currency === 'EUR' ? c.prices?.eur : c.prices?.usd) ?? null,
}));

import { DecksIndexPage } from './DecksIndexPage';

function priced(usd: string, eur: string) {
  return { name: 'Card', prices: { usd, eur } };
}

function makeDeck(id: string, name: string, cards: ReturnType<typeof priced>[]) {
  return {
    id,
    name,
    commander: priced('20.00', '15.00'),
    cards: cards.map((card) => ({ card })),
    sideboard: [],
    color: '#888',
    format: 'commander',
    source: 'manual',
    updatedAt: 0,
  };
}

function valueOf(name: string): string | null {
  const row = screen.getByText(name).closest('li');
  return row?.querySelector('.decks-index-card-value')?.textContent ?? null;
}

describe('DecksIndexPage — deck value', () => {
  beforeEach(() => {
    localStorage.clear();
    useCurrencyStore.setState({ currency: 'USD' });
    mockDecks = [
      makeDeck('cheap', 'Cheap Deck', [priced('1.25', '1.00')]),
      makeDeck('pricey', 'Pricey Deck', [priced('400.00', '350.00'), priced('12.40', '10.00')]),
    ];
  });
  afterEach(() => localStorage.clear());

  it('prints each deck value, commander included, in whole units from 10 up', () => {
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(valueOf('Cheap Deck')).toBe('$21');
    expect(valueOf('Pricey Deck')).toBe('$432');
  });

  it('follows the display currency', () => {
    useCurrencyStore.setState({ currency: 'EUR' });
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(valueOf('Pricey Deck')).toMatch(/375/);
    expect(valueOf('Pricey Deck')).toMatch(/€/);
  });

  it('shows no value for a deck with nothing priced', () => {
    mockDecks = [{ ...makeDeck('empty', 'Empty Deck', []), commander: undefined }];
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(valueOf('Empty Deck')).toBeNull();
  });
});
