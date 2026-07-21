// @vitest-environment happy-dom
/**
 * DiscoverDecksPage — the ponytail-mandated one runnable check for this
 * page's branching (skeleton -> tiles / empty / error+retry), matching the
 * app's existing convention of not exhaustively unit-testing page
 * components (see FriendsPage.test.tsx).
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DiscoverDeck } from '../lib/discover-client';

const { mockListDiscoverDecks } = vi.hoisted(() => ({ mockListDiscoverDecks: vi.fn() }));
vi.mock('../lib/discover-client', () => ({ listDiscoverDecks: mockListDiscoverDecks }));

// The tile resolves commander art via useCardThumb (a batched network fetch)
// — stubbed so the test stays hermetic and only exercises this page's own
// fetch/branch logic, not card-art resolution.
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
  });

  it('shows a loading skeleton, then renders tiles on a resolved fetch', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [makeDeck()], page: 1, hasMore: false });
    renderPage();

    expect(screen.getByText(/loading public decks/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
    expect(screen.getByRole('link', { name: /by alice/i }).getAttribute('href')).toBe('/u/alice');
  });

  it('renders the empty state on an empty resolved list', async () => {
    mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
    renderPage();

    await waitFor(() => expect(screen.getByText('No public decks yet.')).toBeTruthy());
  });

  it('renders an error row with Retry on a rejected fetch, which recovers on click', async () => {
    mockListDiscoverDecks.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    await waitFor(() => expect(screen.getByText('Network down')).toBeTruthy());

    mockListDiscoverDecks.mockResolvedValueOnce({ decks: [makeDeck()], page: 1, hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Atraxa Superfriends')).toBeTruthy());
  });
});
