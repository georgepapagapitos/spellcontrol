// @vitest-environment happy-dom
/**
 * Publish/unpublish from the decks index — the row ⋮ menu and the
 * multi-select bar. Before this, a deck's visibility could only be changed by
 * opening the Share dialog on one deck at a time; the index offered no
 * visibility action at all, and multi-select's only bulk action was Delete.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedPublication } from '../lib/publications-client';

let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: mockDecks, deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));

let authStatus: 'unknown' | 'loading' | 'authed' | 'guest' = 'authed';
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

const { listMyPublicationsMock, publishDeckMock, unpublishDeckMock, MockDisplayNameRequiredError } =
  vi.hoisted(() => {
    class MockDisplayNameRequiredError extends Error {}
    return {
      listMyPublicationsMock: vi.fn(),
      publishDeckMock: vi.fn(),
      unpublishDeckMock: vi.fn(),
      MockDisplayNameRequiredError,
    };
  });

vi.mock('../lib/publications-client', () => ({
  listMyPublications: () => listMyPublicationsMock(),
  publishDeck: (id: string) => publishDeckMock(id),
  unpublishDeck: (id: string) => unpublishDeckMock(id),
  DisplayNameRequiredError: MockDisplayNameRequiredError,
}));

const toastShowMock = vi.fn();
vi.mock('../store/toasts', () => ({ toast: { show: (o: unknown) => toastShowMock(o) } }));

// ── Heavy component stubs (mirrors DecksIndexPage.publicbadge.test.tsx) ──────
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../components/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('../lib/deck-validation', () => ({
  effectiveDeckColors: () => [],
  deckColorFrequency: () => [],
  validateDeck: () => ({ errors: [] }),
  countFlaggedCards: () => 0,
}));
vi.mock('../deck-builder/services/scryfall/client', () => ({ getCardPrice: () => null }));

import { DecksIndexPage } from './DecksIndexPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

function makeDeck(id: string, name: string) {
  return {
    id,
    name,
    cards: [],
    sideboard: [],
    color: '#888',
    format: 'commander',
    source: 'manual',
    updatedAt: 0,
  };
}

function pub(deckId: string): OwnedPublication {
  return { deckId, slug: `${deckId}-slug`, unpublishedAt: null, viewCount: 0, copyCount: 0 };
}

/** Open one row's ⋮ menu so its items become queryable. */
function openRowMenu(deckName: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${deckName}` }));
}

describe('DecksIndexPage — visibility actions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authStatus = 'authed';
    mockDecks = [makeDeck('deck-a', 'Alpha Deck'), makeDeck('deck-b', 'Beta Deck')];
    listMyPublicationsMock.mockResolvedValue([]);
    publishDeckMock.mockResolvedValue(pub('deck-a'));
    unpublishDeckMock.mockResolvedValue(undefined);
  });
  afterEach(() => localStorage.clear());

  it('offers "Make public" on a private deck and publishes it, lighting up the badge', async () => {
    renderPage();
    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));

    openRowMenu('Alpha Deck');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledWith('deck-a'));
    // The badge must move without a refetch — a stale Globe is exactly the
    // "did that even work?" doubt this action exists to remove.
    const badge = await screen.findByLabelText('Public');
    expect(badge.closest('li')?.textContent).toContain('Alpha Deck');
  });

  it('offers "Make private" on a published deck and unpublishes it, clearing the badge', async () => {
    listMyPublicationsMock.mockResolvedValue([pub('deck-a')]);
    renderPage();
    await screen.findByLabelText('Public');

    openRowMenu('Alpha Deck');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make private' }));

    await waitFor(() => expect(unpublishDeckMock).toHaveBeenCalledWith('deck-a'));
    await waitFor(() => expect(screen.queryByLabelText('Public')).toBeNull());
  });

  it('publishes every selected deck from the bulk bar', async () => {
    renderPage();
    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make public' }));

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(2));
    expect(publishDeckMock).toHaveBeenCalledWith('deck-a');
    expect(publishDeckMock).toHaveBeenCalledWith('deck-b');
  });

  it('skips decks already at the target visibility rather than re-publishing them', async () => {
    listMyPublicationsMock.mockResolvedValue([pub('deck-a')]);
    renderPage();
    await screen.findByLabelText('Public');

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make public' }));

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(1));
    expect(publishDeckMock).toHaveBeenCalledWith('deck-b');
  });

  it('stops on a missing display name and hands off to the Share dialog instead of dead-ending', async () => {
    publishDeckMock.mockRejectedValue(new MockDisplayNameRequiredError('display_name_required'));
    renderPage();
    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));

    openRowMenu('Alpha Deck');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

    await waitFor(() =>
      expect(toastShowMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Set a display name to publish.' })
      )
    );
    expect(screen.queryByLabelText('Public')).toBeNull();
  });

  it('shows no visibility action to a guest — publishing is account-scoped', async () => {
    authStatus = 'guest';
    renderPage();

    openRowMenu('Alpha Deck');
    expect(screen.queryByRole('menuitem', { name: 'Make public' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeTruthy();
  });
});
