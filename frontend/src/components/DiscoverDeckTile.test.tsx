// @vitest-environment happy-dom
/**
 * DiscoverDeckTile — dedicated unit coverage for the tile-system-v2 art-
 * banner branches (grid view): banner art vs fallback color banner, on-art
 * overlay stats thresholding, the segmented color-identity bar (incl. the
 * colorless fallback segment), and the buildable-vs-value-vs-omitted footer.
 * Previously only exercised indirectly through DiscoverDecksPage.test.tsx /
 * SavedDecksPage.test.tsx; this file is the component's own.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverDeck } from '../lib/discover-client';

const { useCardThumbMock } = vi.hoisted(() => ({ useCardThumbMock: vi.fn() }));
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: useCardThumbMock }));

// Named-export-complete: LikeButton/BookmarkButton (rendered by every tile)
// import these from the same module.
vi.mock('../lib/discover-client', () => ({
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));

import { DiscoverDeckTile, type DiscoverTileView } from './DiscoverDeckTile';

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
    likeCount: 8,
    // Fixed "2h ago" rather than a live Date.now() offset, so the recency
    // assertion below can't flake across a slow test run.
    publishedAt: Date.now() - 2 * 60 * 60 * 1000,
    cardOracleIds: [],
    likedByViewer: false,
    bookmarkedByViewer: false,
    ...overrides,
  };
}

function renderTile(
  deckOverrides: Partial<DiscoverDeck> = {},
  view: DiscoverTileView = 'grid',
  otherProps: Partial<Omit<React.ComponentProps<typeof DiscoverDeckTile>, 'deck' | 'view'>> = {}
) {
  return render(
    <MemoryRouter>
      <ul>
        <DiscoverDeckTile deck={makeDeck(deckOverrides)} view={view} {...otherProps} />
      </ul>
    </MemoryRouter>
  );
}

describe('DiscoverDeckTile — grid art banner', () => {
  it('renders the commander art as a lazy-loaded banner image when a thumb resolves', () => {
    useCardThumbMock.mockReturnValue('https://cdn.example/atraxa.jpg');
    const { container } = renderTile();

    const img = container.querySelector('.discover-tile-banner .decks-index-card-art');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://cdn.example/atraxa.jpg');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(container.querySelector('.decks-index-card-banner')).toBeFalsy();
  });

  it('falls back to the color-pip banner when no commander art resolves', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile();

    expect(container.querySelector('.discover-tile-banner .decks-index-card-banner')).toBeTruthy();
    expect(container.querySelector('.decks-index-card-art')).toBeFalsy();
  });

  it('overlays views/copies/recency on the banner, thresholding views/copies exactly like the list stats line', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ viewCount: 340, copyCount: 12 });

    const stats = container.querySelector('.discover-tile-banner-stats');
    expect(stats?.textContent).toContain('340 views');
    expect(stats?.textContent).toContain('12 copies');
    expect(stats?.textContent).toMatch(/2h ago/);
  });

  it('hides views/copies below the public-count floor but still shows recency (never a bare empty overlay)', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ viewCount: 2, copyCount: 0 });

    const stats = container.querySelector('.discover-tile-banner-stats');
    expect(stats?.textContent).not.toContain('views');
    expect(stats?.textContent).not.toContain('copies');
    expect(stats?.textContent).toMatch(/2h ago/);
  });

  it('renders one segment per color-identity color, using the WUBRG segment classes', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ colorIdentity: ['W', 'U'] });

    const segs = container.querySelectorAll('.discover-tile-colorbar-seg');
    expect(segs.length).toBe(2);
    expect(segs[0].className).toContain('discover-tile-colorbar-seg--w');
    expect(segs[1].className).toContain('discover-tile-colorbar-seg--u');
  });

  it('renders a single neutral segment for a colorless deck instead of an empty bar', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ colorIdentity: [] });

    const segs = container.querySelectorAll('.discover-tile-colorbar-seg');
    expect(segs.length).toBe(1);
    expect(segs[0].className).toContain('discover-tile-colorbar-seg--c');
  });

  it('shows the buildable meter (not the value) in the footer when buildablePercent is set', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ estimatedValueUsd: 245 }, 'grid', { buildablePercent: 82 });

    expect(screen.getByText('82% buildable')).toBeTruthy();
    expect(container.querySelector('.discover-tile-value-footer')).toBeFalsy();
  });

  it('falls back to the estimated value when buildablePercent is null but a value exists', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ estimatedValueUsd: 245 }, 'grid', {
      buildablePercent: null,
    });

    expect(container.querySelector('.discover-tile-value-footer')?.textContent).toBe('$245.00');
    expect(screen.queryByText(/buildable/)).toBeFalsy();
  });

  it('omits the footer row entirely when both buildablePercent and value are unknown (no empty shell)', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ estimatedValueUsd: null }, 'grid', {
      buildablePercent: null,
    });

    expect(container.querySelector('.discover-tile-footer')).toBeFalsy();
  });

  it('renders the owner as an avatar + display name link, and a mouse-only Open pill', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ ownerUsername: 'alice' });

    const owner = screen.getByRole('link', { name: 'By alice' });
    expect(owner.getAttribute('href')).toBe('/u/alice');
    expect(container.querySelector('.discover-tile-owner .user-avatar')).toBeTruthy();

    const openPill = container.querySelector('.discover-tile-open-pill');
    expect(openPill).toBeTruthy();
    expect(openPill?.getAttribute('aria-hidden')).toBe('true');
    expect(openPill?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('DiscoverDeckTile — list view stays the pre-v2 compact row', () => {
  it('renders the plain-text owner caption, no color bar, and no Open pill', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ ownerUsername: 'alice' }, 'list');

    expect(screen.getByText('by alice')).toBeTruthy();
    expect(container.querySelector('.discover-tile-colorbar')).toBeFalsy();
    expect(container.querySelector('.discover-tile-open-pill')).toBeFalsy();
    expect(container.querySelector('.discover-tile-banner-stats')).toBeFalsy();
  });

  it('keeps the original price + views/copies/likes stats line in the body', () => {
    useCardThumbMock.mockReturnValue(undefined);
    const { container } = renderTile({ estimatedValueUsd: 245, likeCount: 8 }, 'list');

    const stats = container.querySelector('.discover-tile-stats');
    expect(stats?.textContent).toContain('$245.00');
    expect(stats?.textContent).toContain('340 views');
    expect(stats?.textContent).toContain('8 likes');
  });
});
