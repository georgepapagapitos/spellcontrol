// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DiscoverDeck, ListDiscoverDecksResult } from '../../lib/discover-client';

const mockListDiscoverDecks = vi.fn<() => Promise<ListDiscoverDecksResult>>();
vi.mock('../../lib/discover-client', () => ({
  listDiscoverDecks: () => mockListDiscoverDecks(),
}));

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: mockUseCardThumb }));

import { DiscoverCard } from './DiscoverCard';

function renderCard() {
  return render(
    <MemoryRouter>
      <DiscoverCard />
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
    colorIdentity: ['W', 'U', 'B', 'G'],
    bracket: 3,
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

beforeEach(() => {
  mockListDiscoverDecks.mockReset();
  mockUseCardThumb.mockReset();
  mockUseCardThumb.mockReturnValue(undefined);
});

describe('DiscoverCard', () => {
  it('renders for a guest with no auth gating — populated rows and a View all link', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [makeDeck()],
      page: 1,
      hasMore: false,
    });
    renderCard();
    expect(screen.getByLabelText('Loading')).toBeTruthy();

    const link = await screen.findByRole('link', {
      name: "Atraxa Superfriends, Atraxa, Praetors' Voice, by @alice",
    });
    expect(link.getAttribute('href')).toBe('/d/atraxa-superfriends-ab12');
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });

  it('omits the commander line when commanderName is null', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [makeDeck({ commanderName: null })],
      page: 1,
      hasMore: false,
    });
    renderCard();
    const link = await screen.findByRole('link', { name: 'Atraxa Superfriends, by @alice' });
    expect(link).toBeTruthy();
  });

  it('shows the empty state when there are no public decks', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderCard();
    await waitFor(() => expect(screen.getByText('No public decks yet.')).toBeTruthy());
  });

  it('caps rows at 5', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: Array.from({ length: 8 }, (_, i) =>
        makeDeck({ slug: `deck-${i}`, name: `Deck ${i}` })
      ),
      page: 1,
      hasMore: true,
    });
    renderCard();
    await waitFor(() => expect(screen.getByText(/Deck 0/)).toBeTruthy());
    // 5 deck rows + 1 "View all" link
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });

  it('shows an error with Retry, and Retry re-fetches', async () => {
    mockListDiscoverDecks.mockRejectedValueOnce(new Error('network down'));
    renderCard();
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());

    mockListDiscoverDecks.mockResolvedValueOnce({ decks: [], page: 1, hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(screen.getByText('No public decks yet.')).toBeTruthy());
  });

  it("renders the commander's art-crop thumbnail when one resolves", async () => {
    mockUseCardThumb.mockReturnValue('atraxa-art-crop.png');
    mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
    const { container } = renderCard();
    await screen.findByRole('link', { name: /Atraxa Superfriends/ });
    expect(mockUseCardThumb).toHaveBeenCalledWith("Atraxa, Praetors' Voice", 'art_crop');
    const img = container.querySelector('.discover-card-art img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('atraxa-art-crop.png');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('shows the art skeleton placeholder (never a broken img) when nothing resolves', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [makeDeck({ commanderName: null })],
      page: 1,
      hasMore: false,
    });
    const { container } = renderCard();
    await screen.findByRole('link', { name: /Atraxa Superfriends/ });
    expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'art_crop');
    expect(container.querySelector('.discover-card-art img')).toBeNull();
    expect(container.querySelector('.discover-card-art-ph')).toBeTruthy();
  });
});
