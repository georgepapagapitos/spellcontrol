// @vitest-environment happy-dom
/**
 * FreshDecksRail — the welcome storefront's ghost-town-proofed "fresh public
 * decks" rail: renders the DiscoverDeckTile grid at >= 3 decks, renders
 * nothing below that (and nothing on a fetch error, and nothing before the
 * fetch resolves) so a cold platform never shows a broken-looking shell on
 * the marketing landing page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DiscoverDeck } from '../../lib/discover-client';

const { mockListDiscoverDecks } = vi.hoisted(() => ({ mockListDiscoverDecks: vi.fn() }));
// Named-export-complete: DiscoverDeckTile also mounts LikeButton/BookmarkButton,
// which import the like/bookmark client fns from this same module.
vi.mock('../../lib/discover-client', () => ({
  listDiscoverDecks: mockListDiscoverDecks,
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { FreshDecksRail } from './FreshDecksRail';

function makeDeck(overrides: Partial<DiscoverDeck> = {}): DiscoverDeck {
  return {
    slug: 'some-deck-ab12',
    name: 'Some Deck',
    ownerUsername: 'alice',
    ownerDisplayName: null,
    ownerAvatarUrl: null,
    format: 'commander',
    commanderName: "Atraxa, Praetors' Voice",
    colorIdentity: ['W', 'U', 'B', 'G'],
    bracket: 3,
    estimatedValueUsd: 245,
    viewCount: 10,
    copyCount: 2,
    likeCount: 1,
    publishedAt: Date.now(),
    cardOracleIds: [],
    likedByViewer: false,
    bookmarkedByViewer: false,
    ...overrides,
  };
}

function renderRail() {
  return render(
    <MemoryRouter>
      <FreshDecksRail />
    </MemoryRouter>
  );
}

describe('FreshDecksRail', () => {
  beforeEach(() => {
    mockListDiscoverDecks.mockReset();
  });

  it('renders the heading, tiles, and a View all link to Discover when >= 3 decks return', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [
        makeDeck({ slug: 'a', name: 'Deck A' }),
        makeDeck({ slug: 'b', name: 'Deck B' }),
        makeDeck({ slug: 'c', name: 'Deck C' }),
      ],
      page: 1,
      hasMore: false,
    });

    renderRail();

    await waitFor(() => {
      expect(screen.getByText('Fresh public decks')).toBeTruthy();
    });
    expect(screen.getByText('Deck A')).toBeTruthy();
    expect(screen.getByText('Deck B')).toBeTruthy();
    expect(screen.getByText('Deck C')).toBeTruthy();
    expect(mockListDiscoverDecks).toHaveBeenCalledWith({ sort: 'newest' });

    const viewAll = screen.getByRole('link', { name: /view all/i });
    expect(viewAll.getAttribute('href')).toBe('/decks/discover');
  });

  it('renders nothing when fewer than 3 decks return', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [makeDeck({ slug: 'a' }), makeDeck({ slug: 'b' })],
      page: 1,
      hasMore: false,
    });

    const { container } = renderRail();
    await waitFor(() => expect(mockListDiscoverDecks).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when zero decks return', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });

    const { container } = renderRail();
    await waitFor(() => expect(mockListDiscoverDecks).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the fetch fails, rather than an error banner', async () => {
    mockListDiscoverDecks.mockRejectedValue(new Error('network down'));

    const { container } = renderRail();
    await waitFor(() => expect(mockListDiscoverDecks).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing before the fetch resolves', () => {
    mockListDiscoverDecks.mockReturnValue(new Promise(() => {}));

    const { container } = renderRail();
    expect(container.firstChild).toBeNull();
  });
});
