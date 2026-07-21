// @vitest-environment happy-dom
/**
 * Tests for the decks-index "Public" badge (visibility-obvious, E-decks):
 * a quiet icon-only Globe glyph on rows with a LIVE deck_publications row
 * only — badges the exception, private rows stay quiet. One fetch of
 * GET /api/publications/decks per page mount, authed only.
 */
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedPublication } from '../lib/publications-client';

// ── Store stubs ─────────────────────────────────────────────────────────────
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

const listMyPublicationsMock = vi.fn<() => Promise<OwnedPublication[]>>();
vi.mock('../lib/publications-client', () => ({
  listMyPublications: () => listMyPublicationsMock(),
}));

// ── Heavy component stubs (mirrors DecksIndexPage.emptystate.test.tsx) ──────
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

function pub(deckId: string, unpublishedAt: number | null): OwnedPublication {
  return { deckId, slug: `${deckId}-slug`, unpublishedAt, viewCount: 0, copyCount: 0 };
}

describe('DecksIndexPage — Public badge', () => {
  beforeEach(() => {
    localStorage.clear();
    authStatus = 'authed';
    mockDecks = [makeDeck('deck-live', 'Live Deck'), makeDeck('deck-quiet', 'Quiet Deck')];
    listMyPublicationsMock.mockReset().mockResolvedValue([]);
  });
  afterEach(() => localStorage.clear());

  it('badges only the deck with a live publication, leaving the other quiet', async () => {
    listMyPublicationsMock.mockResolvedValue([pub('deck-live', null)]);
    renderPage();

    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));
    const badges = await screen.findAllByLabelText('Public');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('li')?.textContent).toContain('Live Deck');
  });

  it('renders no badge at all when nothing is published', async () => {
    renderPage();
    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Public')).toBeNull();
  });

  it('does not badge a deck whose publication was unpublished', async () => {
    listMyPublicationsMock.mockResolvedValue([pub('deck-live', 1234)]);
    renderPage();
    await waitFor(() => expect(listMyPublicationsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Public')).toBeNull();
  });

  it('never fetches for a guest, and shows no badge', async () => {
    authStatus = 'guest';
    renderPage();
    // Give any stray effect a tick to (not) fire before asserting.
    await Promise.resolve();
    expect(listMyPublicationsMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Public')).toBeNull();
  });
});
