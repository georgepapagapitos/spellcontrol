// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DiscoverDeck, ListDiscoverDecksResult } from '../../lib/discover-client';

const mockListDiscoverDecks = vi.fn<(params: unknown) => Promise<ListDiscoverDecksResult>>();
// Named-export-complete: the tiles' Like/Bookmark buttons import these too.
vi.mock('../../lib/discover-client', () => ({
  listDiscoverDecks: (params: unknown) => mockListDiscoverDecks(params),
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { DiscoverRow } from './DiscoverRow';

function renderRow() {
  return render(
    <MemoryRouter>
      <DiscoverRow />
    </MemoryRouter>
  );
}

function makeDeck(overrides: Partial<DiscoverDeck> = {}): DiscoverDeck {
  return {
    slug: 'atraxa-superfriends-ab12',
    name: 'Atraxa Superfriends',
    ownerUsername: 'alice',
    ownerDisplayName: null,
    ownerAvatarUrl: null,
    format: 'commander',
    commanderName: "Atraxa, Praetors' Voice",
    commanderImageNormal: null,
    colorIdentity: ['W', 'U', 'B', 'G'],
    bracket: 3,
    estimatedBracket: null,
    estimatedValueUsd: 245,
    viewCount: 340,
    copyCount: 12,
    likeCount: 8,
    publishedAt: Date.now(),
    cardOracleIds: [],
    likedByViewer: false,
    bookmarkedByViewer: false,
    ...overrides,
  };
}

const tileLinks = () =>
  screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/d/'));

beforeEach(() => {
  mockListDiscoverDecks.mockReset();
});

describe('DiscoverRow', () => {
  // The row is "decks from other players": new decks default to public, so
  // without the flag the newest listings were the viewer's own decks, the
  // same ones Your decks shows right above it.
  it("asks for other players' decks only", async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderRow();
    await waitFor(() => expect(mockListDiscoverDecks).toHaveBeenCalled());
    expect(mockListDiscoverDecks).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'newest', exclude: 'mine' })
    );
  });

  it('shows tile skeletons, then the tiles linking to each public deck', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
    renderRow();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    await waitFor(() => expect(tileLinks()).toHaveLength(1));
    expect(tileLinks()[0].getAttribute('href')).toBe('/d/atraxa-superfriends-ab12');
    expect(screen.getByRole('link', { name: 'Browse' }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });

  it('caps the row at 5', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: Array.from({ length: 8 }, (_, i) =>
        makeDeck({ slug: `deck-${i}`, name: `Deck ${i}` })
      ),
      page: 1,
      hasMore: true,
    });
    renderRow();
    await waitFor(() => expect(tileLinks().length).toBeGreaterThan(0));
    expect(new Set(tileLinks().map((l) => l.getAttribute('href'))).size).toBe(5);
  });

  it('is one quiet line when nobody else has published yet', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderRow();
    await waitFor(() =>
      expect(screen.getByText('No public decks from other players yet.')).toBeTruthy()
    );
    expect(screen.getByRole('link', { name: 'Browse' })).toBeTruthy();
  });

  it('shows an error with Retry, and Retry re-fetches', async () => {
    mockListDiscoverDecks.mockRejectedValueOnce(new Error('network down'));
    renderRow();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('network down'));

    mockListDiscoverDecks.mockResolvedValueOnce({ decks: [], page: 1, hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Discover' }));
    await waitFor(() =>
      expect(screen.getByText('No public decks from other players yet.')).toBeTruthy()
    );
  });

  it('carries its own commander search', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderRow();
    expect(screen.getByLabelText('Search commanders', { selector: 'input' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Search commanders' }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });
});
