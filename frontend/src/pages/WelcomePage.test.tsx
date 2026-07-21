// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadResponse } from '../types';
import type { DiscoverDeck } from '../lib/discover-client';

// --- Module mocks (declared before lazy imports) ---

const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
  useSetMap: () => new Map(),
}));

const loadSampleBindersMock = vi.fn<(r: UploadResponse | null) => Promise<string[]>>();
const setErrorMock = vi.fn<(e: string | null) => void>();

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => {
    const fakeStore = {
      loadSampleBinders: loadSampleBindersMock,
      setError: setErrorMock,
    };
    return sel(fakeStore);
  },
}));

// Capture navigate() calls for assertions. Note this only intercepts
// useNavigate()'s returned function — WelcomeHero's Import/Browse CTAs and
// the alt-start Sign-in door are real <Link>s now, so their destinations are
// asserted via href below, not via this mock.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...real,
    useNavigate: () => navigateMock,
  };
});

// Hermetic art resolution for the hero + both live rails' tiles.
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const { mockListDiscoverDecks } = vi.hoisted(() => ({ mockListDiscoverDecks: vi.fn() }));
// Named-export-complete: DiscoverDeckTile (mounted by FreshDecksRail) also
// pulls LikeButton/BookmarkButton, which import the like/bookmark client fns
// from this same module.
vi.mock('../lib/discover-client', () => ({
  listDiscoverDecks: mockListDiscoverDecks,
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));

import { WelcomePage } from './WelcomePage';
import { hasEverVisited, markEverVisited } from '../lib/first-run';

// ---

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <WelcomePage />
    </MemoryRouter>
  );
}

const STUB_RESPONSE: UploadResponse = {
  cards: [],
  totalRows: 0,
  unresolvedNames: [],
  fetchErrors: [],
  malformedRows: [],
  skippedUnownedRows: 0,
  clampedRows: 0,
  detectedFormat: 'csv',
  scryfallHits: 0,
  scryfallMisses: 0,
};

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

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockReset();
  importTextMock.mockReset();
  loadSampleBindersMock.mockReset();
  setErrorMock.mockReset();
  importTextMock.mockResolvedValue(STUB_RESPONSE);
  loadSampleBindersMock.mockResolvedValue([]);
  mockListDiscoverDecks.mockReset();
  mockListDiscoverDecks.mockResolvedValue({ decks: [], page: 1, hasMore: false });
  // TrendingRail does its own raw fetch (not a mockable client module) —
  // stub it hermetically, same idiom as DiscoverDecksPage.test.tsx. Its own
  // behavior has a dedicated test file (TrendingRail.test.tsx).
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ risingCommanders: [] }), { status: 200 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// Hero — brand, search, CTAs
// ============================================================

describe('WelcomePage hero', () => {
  it('renders the hero with the brand and a Discover-scoped search', () => {
    renderWelcome();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByText('SpellControl')).toBeTruthy();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /search public decks by commander/i })).toBeTruthy();
  });

  it('has an Import CTA and a Browse public decks CTA pointing at the right hrefs', () => {
    renderWelcome();
    expect(screen.getByRole('link', { name: /import your collection/i }).getAttribute('href')).toBe(
      '/collection?add=list'
    );
    expect(screen.getByRole('link', { name: /browse public decks/i }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });

  it('marks ever-visited when the Import CTA is clicked, without touching the sample-load path', () => {
    renderWelcome();
    expect(hasEverVisited()).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: /import your collection/i }));
    expect(hasEverVisited()).toBe(true);
    expect(importTextMock).not.toHaveBeenCalled();
    expect(loadSampleBindersMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// Fresh public decks rail — ghost-town gating
// ============================================================

describe('WelcomePage fresh-decks rail', () => {
  it('renders the rail and its tiles once >= 3 fresh decks return', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [
        makeDeck({ slug: 'a', name: 'Deck A' }),
        makeDeck({ slug: 'b', name: 'Deck B' }),
        makeDeck({ slug: 'c', name: 'Deck C' }),
      ],
      page: 1,
      hasMore: false,
    });

    renderWelcome();

    await waitFor(() => expect(screen.getByText('Fresh public decks')).toBeTruthy());
    expect(screen.getByText('Deck A')).toBeTruthy();
    expect(screen.getByText('Deck B')).toBeTruthy();
    expect(screen.getByText('Deck C')).toBeTruthy();
  });

  it('renders no fresh-decks rail below the 3-deck floor', async () => {
    mockListDiscoverDecks.mockResolvedValue({
      decks: [makeDeck({ slug: 'a' }), makeDeck({ slug: 'b' })],
      page: 1,
      hasMore: false,
    });

    renderWelcome();

    // Wait for a definitely-post-resolution signal (TrendingRail's own
    // stubbed fetch settling) before asserting the negative, rather than
    // just confirming the mock was called (which is already true
    // pre-resolution and would prove nothing about the resolved state).
    await waitFor(() => expect(screen.getByText(/nothing trending yet/i)).toBeTruthy());
    expect(screen.queryByText('Fresh public decks')).toBeNull();
  });
});

// ============================================================
// Render — the rest of the page's content obligations
// ============================================================

describe('WelcomePage renders', () => {
  it('shows the tightened alt-start doors (Try sample cards, Sign in)', () => {
    renderWelcome();
    expect(screen.getByRole('button', { name: /try sample cards/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/auth');
  });

  it('shows the trending rail\'s "View all" link to Discover', () => {
    renderWelcome();
    expect(screen.getByRole('link', { name: /view all public decks/i }).getAttribute('href')).toBe(
      '/decks/discover'
    );
  });

  it('shows the feature grid and legal footer', () => {
    renderWelcome();
    expect(screen.getByText('Rule-based binders')).toBeTruthy();
    expect(screen.getByText(/unofficial fan content/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /import guides/i }).getAttribute('href')).toBe(
      '/guides/'
    );
    expect(screen.getByRole('link', { name: /privacy/i }).getAttribute('href')).toBe(
      '/privacy.html'
    );
  });
});

// ============================================================
// Try sample cards
// ============================================================

describe('Try sample cards', () => {
  it('calls importText then loadSampleBinders, marks visited, navigates to /collection', async () => {
    renderWelcome();
    expect(hasEverVisited()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    await waitFor(() => {
      expect(importTextMock).toHaveBeenCalledTimes(1);
      expect(loadSampleBindersMock).toHaveBeenCalledWith(STUB_RESPONSE);
    });

    expect(hasEverVisited()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith('/collection');
  });

  it('shows a loading state while samples load, without disabling the hero or Sign in', async () => {
    // Make the mock hang until we resolve it manually
    let resolve!: (v: UploadResponse) => void;
    importTextMock.mockReturnValue(new Promise<UploadResponse>((r) => (resolve = r)));

    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    // During load: the samples button shows progress. The hero's Import CTA
    // and the Sign in door are real <Link>s — they have no `disabled` concept
    // at all, but assert they're still present/reachable while this
    // unrelated async op is in flight (UX-331's "disabled-scope matches the
    // interaction, not the page").
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loading samples/i })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: /import your collection/i }).getAttribute('href')).toBe(
      '/collection?add=list'
    );
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/auth');

    // Clean up
    resolve(STUB_RESPONSE);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/collection'));
  });

  it('shows an error message and does NOT mark visited when sample load fails', async () => {
    importTextMock.mockRejectedValue(new Error('Network error'));

    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeTruthy();
    });

    expect(hasEverVisited()).toBe(false);
    expect(navigateMock).not.toHaveBeenCalledWith('/collection');
  });
});

// ============================================================
// Sign in
// ============================================================

describe('Sign in door', () => {
  it('is a real link to /auth and does not mark ever-visited on click', () => {
    renderWelcome();
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(signIn.getAttribute('href')).toBe('/auth');
    fireEvent.click(signIn);
    // Not marked — dismissal happens when the user completes an auth action
    expect(hasEverVisited()).toBe(false);
  });
});

// ============================================================
// No-reshow: gate stays dismissed after the welcome is seen
// ============================================================

describe('Dismissal persistence — no reshow', () => {
  it('hasEverVisited stays true after the Import CTA closes the welcome', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('link', { name: /import your collection/i }));
    expect(hasEverVisited()).toBe(true);
  });

  it('hasEverVisited stays true after Try sample cards closes the welcome', async () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));
    await waitFor(() => expect(hasEverVisited()).toBe(true));
  });

  it('hasEverVisited is still false after Sign in (auth not yet completed)', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('link', { name: /sign in/i }));
    expect(hasEverVisited()).toBe(false);
  });

  it('markEverVisited persists across a simulated remount check', () => {
    markEverVisited();
    // Simulate the gate check a second app boot would do:
    expect(hasEverVisited()).toBe(true);
    // And the localStorage key is set:
    expect(localStorage.getItem('sc-ever-visited-app')).toBe('1');
  });
});
