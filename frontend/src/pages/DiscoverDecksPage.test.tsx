// @vitest-environment happy-dom
/**
 * DiscoverDecksPage — the ponytail-mandated one runnable check for this
 * page's branching (skeleton -> tiles / empty / error+retry), matching the
 * app's existing convention of not exhaustively unit-testing page
 * components (see FriendsPage.test.tsx), plus the filter/sort/buildable
 * wiring `w2-discover-filters-sort` adds.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EnrichedCard, BinderDef } from '../types';
import type { DiscoverDeck } from '../lib/discover-client';

const { mockListDiscoverDecks, mockSearchCommanders } = vi.hoisted(() => ({
  mockListDiscoverDecks: vi.fn(),
  mockSearchCommanders: vi.fn(),
}));
vi.mock('../lib/discover-client', () => ({
  listDiscoverDecks: mockListDiscoverDecks,
  searchCommanders: mockSearchCommanders,
}));

// The tile resolves commander art via useCardThumb (a batched network fetch)
// — stubbed so the test stays hermetic and only exercises this page's own
// fetch/branch logic, not card-art resolution.
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

let authStatus: 'guest' | 'authed' = 'guest';
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

let collectionCards: EnrichedCard[] = [];
vi.mock('../store/collection', () => ({
  useCollectionStore: <T,>(
    selector: (s: { cards: EnrichedCard[]; binders: BinderDef[] }) => T
  ): T => selector({ cards: collectionCards, binders: [] }),
}));

import { DiscoverDecksPage } from './DiscoverDecksPage';

function makeDeck(overrides: Partial<DiscoverDeck> = {}): DiscoverDeck {
  return {
    slug: 'atraxa-superfriends-ab12',
    name: 'Atraxa Superfriends',
    ownerUsername: 'alice',
    format: 'commander',
    commanderName: "Atraxa, Praetors' Voice",
    colorIdentity: ['W', 'U', 'B', 'G'],
    bracket: 3,
    estimatedValueUsd: 245,
    viewCount: 340,
    copyCount: 12,
    publishedAt: Date.now(),
    cardOracleIds: [],
    ...overrides,
  };
}

function ownedCard(oracleId: string): EnrichedCard {
  return {
    copyId: `copy-${oracleId}`,
    name: oracleId,
    oracleId,
    setCode: 'lea',
    setName: 'Limited Edition Alpha',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `sf-${oracleId}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DiscoverDecksPage />
    </MemoryRouter>
  );
}

describe('DiscoverDecksPage', () => {
  beforeEach(() => {
    mockListDiscoverDecks.mockReset();
    mockSearchCommanders.mockReset();
    authStatus = 'guest';
    collectionCards = [];
    localStorage.clear();
  });

  it('shows a loading skeleton, then renders tiles on a resolved fetch', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
    renderPage();

    expect(screen.getByText(/loading public decks/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
    expect(screen.getByRole('link', { name: /by alice/i }).getAttribute('href')).toBe('/u/alice');
  });

  it('renders the empty state on an empty resolved list with no filters active', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderPage();

    await waitFor(() => expect(screen.getByText('No public decks yet.')).toBeTruthy());
  });

  it('renders the filtered-to-zero empty state (distinct copy + Clear filters) once a filter is active', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    render(
      <MemoryRouter initialEntries={['/discover?format=commander']}>
        <DiscoverDecksPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText('No public decks match these filters.')).toBeTruthy()
    );
    expect(screen.queryByText('No public decks yet.')).toBeNull();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeTruthy();
  });

  it('renders an error row with Retry on a rejected fetch, which recovers on click', async () => {
    mockListDiscoverDecks.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    await waitFor(() => expect(screen.getByText('Network down')).toBeTruthy());

    mockListDiscoverDecks.mockResolvedValueOnce({ decks: [makeDeck()], page: 1, hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
  });

  it('shows the budget caveat only while the budget filter is active', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
    render(
      <MemoryRouter initialEntries={['/discover?budget=under50']}>
        <DiscoverDecksPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText('Some decks may not appear until pricing is available.')).toBeTruthy()
    );
  });

  describe('sort-option inclusion (buildable) across auth x collection-size', () => {
    const sortTrigger = () => screen.getByRole('button', { name: /sort discover decks by/i });

    async function renderAndOpenSort() {
      mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
      renderPage();
      await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
      fireEvent.click(sortTrigger());
    }

    it('guest + empty collection: no buildable option', async () => {
      authStatus = 'guest';
      collectionCards = [];
      await renderAndOpenSort();
      expect(screen.queryByRole('option', { name: 'Percent buildable' })).toBeNull();
    });

    it('guest + non-empty collection: no buildable option (not authed)', async () => {
      authStatus = 'guest';
      collectionCards = [ownedCard('x1')];
      await renderAndOpenSort();
      expect(screen.queryByRole('option', { name: 'Percent buildable' })).toBeNull();
    });

    it('authed + empty collection: no buildable option (nothing to compare against)', async () => {
      authStatus = 'authed';
      collectionCards = [];
      await renderAndOpenSort();
      expect(screen.queryByRole('option', { name: 'Percent buildable' })).toBeNull();
    });

    it('authed + non-empty collection: buildable option is offered', async () => {
      authStatus = 'authed';
      collectionCards = [ownedCard('x1')];
      await renderAndOpenSort();
      expect(screen.getByRole('option', { name: 'Percent buildable' })).toBeTruthy();
    });
  });

  it('buildable sort re-sorts the accumulated list client-side, descending, with stable ties (no refetch)', async () => {
    authStatus = 'authed';
    collectionCards = [ownedCard('x1'), ownedCard('x2'), ownedCard('z1'), ownedCard('w1')];

    // Fetch order: A (100%), B (0%), C (100%, ties A), D (50%).
    // Expected buildable order: A, C (tie preserves fetch order), D, B.
    const deckA = makeDeck({ slug: 'a', ownerUsername: 'deck-a', cardOracleIds: ['x1', 'x2'] });
    const deckB = makeDeck({ slug: 'b', ownerUsername: 'deck-b', cardOracleIds: ['y1', 'y2'] });
    const deckC = makeDeck({ slug: 'c', ownerUsername: 'deck-c', cardOracleIds: ['z1'] });
    const deckD = makeDeck({ slug: 'd', ownerUsername: 'deck-d', cardOracleIds: ['w1', 'w2'] });
    mockListDiscoverDecks.mockResolvedValue({
      decks: [deckA, deckB, deckC, deckD],
      page: 1,
      hasMore: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^by /i })).toHaveLength(4));
    expect(mockListDiscoverDecks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /sort discover decks by/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Percent buildable' }));

    const owners = screen.getAllByRole('link', { name: /^by /i }).map((el) => el.textContent);
    expect(owners).toEqual(['by deck-a', 'by deck-c', 'by deck-d', 'by deck-b']);

    // Switching to the client-only buildable sort must not trigger a second
    // fetch — the server never sees `sort=buildable`.
    expect(mockListDiscoverDecks).toHaveBeenCalledTimes(1);
  });
});
