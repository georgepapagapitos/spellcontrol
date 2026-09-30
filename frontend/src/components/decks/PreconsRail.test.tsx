// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverDeck } from '@/lib/discover/discover-client';
import { NO_DISCOVER_FILTERS } from '@/lib/discover/discover-filters';

const { mockListDiscoverDecks } = vi.hoisted(() => ({ mockListDiscoverDecks: vi.fn() }));
// Named-export-complete: the tile's Like/Bookmark buttons import from here too.
vi.mock('@/lib/discover/discover-client', () => ({
  listDiscoverDecks: mockListDiscoverDecks,
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { PreconsRail } from './PreconsRail';

function precon(slug: string, name: string): DiscoverDeck {
  return {
    slug,
    name,
    ownerUsername: 'spellcontrol',
    ownerDisplayName: 'SpellControl',
    ownerAvatarUrl: null,
    format: 'commander',
    commanderName: 'Kaalia of the Vast',
    commanderImageNormal: null,
    colorIdentity: ['R', 'W', 'B'],
    bracket: null,
    estimatedBracket: null,
    estimatedValueUsd: null,
    viewCount: 0,
    copyCount: 0,
    likeCount: 0,
    publishedAt: Date.UTC(2011, 5, 17),
    cardOracleIds: [],
    likedByViewer: false,
    bookmarkedByViewer: false,
    ogArtCrop: null,
  };
}

function renderRail(filters = NO_DISCOVER_FILTERS) {
  return render(
    <MemoryRouter>
      <PreconsRail filters={filters} />
    </MemoryRouter>
  );
}

describe('PreconsRail', () => {
  beforeEach(() => {
    mockListDiscoverDecks.mockReset();
  });

  it('asks for the precons shelf, newest first, and shows its tiles', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [precon('a', 'Heavenly Inferno (2011)'), precon('b', 'Calling All Angels')],
      page: 1,
      hasMore: false,
    });
    renderRail();

    expect(screen.getByText('Loading precons…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Calling All Angels')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Precons' })).toBeTruthy();
    expect(mockListDiscoverDecks).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'precons', sort: 'newest' })
    );
    expect(screen.getByRole('link', { name: /view all/i }).getAttribute('href')).toBe(
      '/decks/discover?source=precons'
    );
  });

  it('narrows with the page filters, and View all goes where the page says', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [precon('a', 'Heavenly Inferno (2011)')],
      page: 1,
      hasMore: false,
    });
    render(
      <MemoryRouter>
        <PreconsRail
          filters={{ ...NO_DISCOVER_FILTERS, query: 'kaalia', colors: ['R'] }}
          viewAllTo="/decks/discover?q=kaalia&colors=R&source=precons"
        />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Heavenly Inferno (2011)')).toBeTruthy());
    expect(mockListDiscoverDecks).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'precons', query: 'kaalia', colors: ['R'] })
    );
    expect(screen.getByRole('link', { name: /view all/i }).getAttribute('href')).toBe(
      '/decks/discover?q=kaalia&colors=R&source=precons'
    );
  });

  it('renders nothing when no precon matches', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    const { container } = renderRail();
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when the fetch fails', async () => {
    mockListDiscoverDecks.mockRejectedValue(new Error('offline'));
    const { container } = renderRail();
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
