// @vitest-environment happy-dom
/**
 * SavedDecksPage — the ponytail-mandated runnable check for this page's
 * branching (guest-gate / skeleton / tiles / empty / error+retry) plus the
 * one behavior genuinely unique to this page: an unsave removes its tile
 * without a refetch.
 */
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAuth } from '../store/auth';
import type { DiscoverDeck } from '../lib/discover-client';

const { listBookmarkedDecksMock, unbookmarkDeckMock } = vi.hoisted(() => ({
  listBookmarkedDecksMock: vi.fn(),
  unbookmarkDeckMock: vi.fn(),
}));
vi.mock('../lib/discover-client', () => ({
  listBookmarkedDecks: listBookmarkedDecksMock,
  unbookmarkDeck: unbookmarkDeckMock,
  bookmarkDeck: vi.fn(),
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
}));
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { SavedDecksPage } from './SavedDecksPage';

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
    likeCount: 9,
    publishedAt: Date.now(),
    cardOracleIds: [],
    likedByViewer: false,
    bookmarkedByViewer: true,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SavedDecksPage />
    </MemoryRouter>
  );
}

function authed() {
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
}

describe('SavedDecksPage', () => {
  beforeEach(() => {
    listBookmarkedDecksMock.mockReset();
    unbookmarkDeckMock.mockReset();
  });

  it('shows the guest-gate empty-state for an unauthenticated direct visit, with a returnTo sign-in link, and never fetches', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderPage();

    expect(screen.getByText('Saved decks need an account')).toBeTruthy();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/auth?returnTo=%2Fdecks%2Fsaved');
    expect(listBookmarkedDecksMock).not.toHaveBeenCalled();
  });

  it('renders fetched bookmarks as full tiles, not a degraded shape', async () => {
    authed();
    listBookmarkedDecksMock.mockResolvedValue([makeDeck()]);
    renderPage();

    expect(screen.getByText(/loading your saved decks/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
    // Full tile content — owner link, price, and a pre-bookmarked Save button
    // — proves this is the same DiscoverDeckTile, not a narrower rendering.
    expect(screen.getByRole('link', { name: /by alice/i })).toBeTruthy();
    expect(screen.getByText('$245.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the empty state with a link to Discover when authed with zero bookmarks', async () => {
    authed();
    listBookmarkedDecksMock.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Nothing saved yet.')).toBeTruthy());
    // Scoped to the empty-state hint — DecksHubTabs above it renders its own
    // "Discover" nav link too, so an unscoped query matches both.
    const emptyState = screen.getByText('Nothing saved yet.').closest<HTMLElement>('.empty-state')!;
    expect(within(emptyState).getByRole('link', { name: 'Discover' }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });

  it('renders an error row with Retry on a rejected fetch, which recovers on click', async () => {
    authed();
    listBookmarkedDecksMock.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    await waitFor(() => expect(screen.getByText('Network down')).toBeTruthy());

    listBookmarkedDecksMock.mockResolvedValueOnce([makeDeck()]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
  });

  it('unsaving removes the tile immediately on confirmation, with no refetch', async () => {
    authed();
    listBookmarkedDecksMock.mockResolvedValue([makeDeck()]);
    unbookmarkDeckMock.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
    expect(listBookmarkedDecksMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Atraxa Superfriends')).toBeNull());
    expect(screen.getByText('Nothing saved yet.')).toBeTruthy();
    // No second list fetch — the removal is a local splice, not a refetch.
    expect(listBookmarkedDecksMock).toHaveBeenCalledTimes(1);
  });
});
