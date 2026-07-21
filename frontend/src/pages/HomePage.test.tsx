// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub AddCardsSheet so opening it doesn't mount the full modal stack
// (CardScanner, UploadPanel, etc.) — mirrors CollectionPage.test.tsx.
vi.mock('../components/AddCardsSheet', () => ({
  AddCardsSheet: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-cards-sheet">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// All eight bento cards (3 social + 5 signal) fetch or read IndexedDB on
// mount — stubbed so this suite stays hermetic and only exercises
// HomePage's own composition, not each card's own branching (covered by
// each card's own test file).
vi.mock('../lib/use-activity', () => ({
  useActivity: () => ({ count: 0, actionRequired: [], recent: [], loading: false }),
}));

// Controllable per-test — mutated directly (not via mockReturnValue) since
// useAuth's real shape is a selector-hook, not a plain mock return. Reset to
// the authed default in beforeEach so no test leaks state into the next.
const mockAuthState = vi.hoisted(() => ({
  status: 'authed' as 'authed' | 'guest',
  user: { id: 'u1', username: 'georgep', role: 'user' as const },
  profile: null as { displayName: string | null } | null,
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock('../lib/friends-client', () => ({
  getFriendsActivity: () => Promise.resolve([]),
}));
vi.mock('../lib/discover-client', () => ({
  listDiscoverDecks: () => Promise.resolve({ decks: [], page: 1, hasMore: false }),
}));
vi.mock('../components/play/GameNights', () => ({
  useGameNights: () => ({ nights: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../lib/value-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/value-history')>();
  return {
    ...actual,
    getValueHistory: () => Promise.resolve([]),
    getLatestMovers: () => Promise.resolve(null),
  };
});

// The hero's own pure picks — mocked so a branch (art vs fallback) is a
// deterministic setup, not dependent on this file's real (empty) collection/
// decks stores, and so the time-of-day greeting can't make an assertion
// flaky depending on when the suite happens to run.
const mockPickHeroCard = vi.hoisted(() =>
  vi.fn(() => null as { name: string; art?: string; reason: 'top' | 'recent' | 'commander' } | null)
);
vi.mock('../lib/home-hero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/home-hero')>();
  return { ...actual, pickHeroCard: mockPickHeroCard, heroGreeting: () => 'Good morning' };
});

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../lib/card-thumbs', () => ({
  useCardThumb: mockUseCardThumb,
  imageFromCard: () => undefined,
}));

// The hero reads live sync state to distinguish "settled empty" from "still
// settling" — pinned to idle here so the fallback branch is deterministic;
// the settling branch flips this per-test.
const mockSyncState = vi.hoisted(() => ({ state: 'idle' as string }));
vi.mock('../lib/sync', () => ({
  getSyncState: () => mockSyncState.state,
  onSyncedChange: () => () => {},
}));

import { HomePage } from './HomePage';
import { useCollectionStore } from '../store/collection';

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuthState.status = 'authed';
  mockAuthState.user = { id: 'u1', username: 'georgep', role: 'user' };
  mockAuthState.profile = null;
  mockPickHeroCard.mockReturnValue(null);
  mockUseCardThumb.mockReturnValue(undefined);
  mockSyncState.state = 'idle';
  // The real store boots with hydrating: true (App flips it after the IDB
  // hydrate); settle it here so the fallback branch is reachable by default.
  useCollectionStore.setState({ hydrating: false });
});

describe('HomePage', () => {
  it('renders the hero greeting and all eight bento cards', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Good morning, georgep' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'New from friends' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Discover' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Recent decks' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Game nights' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Value movers' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'New arrivals' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Binder review' })).toBeTruthy();
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });

  it('renders Quick Actions with the correct link targets', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /New deck/i }).getAttribute('href')).toBe('/decks/new');
    expect(screen.getByRole('link', { name: /Plan a game night/i }).getAttribute('href')).toBe(
      '/play?tab=nights'
    );
    expect(screen.getByRole('button', { name: /Import cards/i })).toBeTruthy();
  });

  it('opens AddCardsSheet when "Import cards" is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Import cards/i }));
    expect(screen.getByTestId('add-cards-sheet')).toBeTruthy();
  });

  it('closes AddCardsSheet via its onClose callback', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Import cards/i }));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });

  describe('hero featured card', () => {
    it('shows the empty-sleeve brand fallback (no art) for a brand-new empty collection', () => {
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeTruthy();
      expect(container.querySelector('.home-hero-art')).toBeNull();
      expect(container.querySelector('.home-hero-caption')).toBeNull();
    });

    it('shows the card art + tape-label caption once a hero card resolves', () => {
      mockPickHeroCard.mockReturnValue({ name: 'Sol Ring', reason: 'top' });
      mockUseCardThumb.mockReturnValue('sol-ring.png');
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeNull();
      const img = container.querySelector('.home-hero-art') as HTMLImageElement | null;
      expect(img?.getAttribute('src')).toBe('sol-ring.png');
      expect(img?.getAttribute('alt')).toBe('');
      expect(screen.getByText('Sol Ring')).toBeTruthy();
      expect(screen.getByText('One of your most valuable cards')).toBeTruthy();
    });

    it('renders the owned printing art directly, skipping name resolution', () => {
      mockPickHeroCard.mockReturnValue({
        name: 'Sol Ring',
        art: 'owned-printing.jpg',
        reason: 'top',
      });
      const { container } = renderPage();
      const img = container.querySelector('.home-hero-art') as HTMLImageElement | null;
      expect(img?.getAttribute('src')).toBe('owned-printing.jpg');
      // useCardThumb is skipped (called with undefined) when owned art is in hand.
      expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'art_crop');
    });

    it('shows the loading shimmer, never the brand fallback, while still hydrating/syncing', () => {
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeNull();
      expect(container.querySelector('.home-hero-art-loading')).toBeTruthy();

      useCollectionStore.setState({ hydrating: false });
      mockSyncState.state = 'syncing';
      const { container: c2 } = renderPage();
      expect(c2.querySelector('.home-hero-fallback')).toBeNull();
      expect(c2.querySelector('.home-hero-art-loading')).toBeTruthy();
    });

    it('never shows personal art for a guest, even if a hero card would otherwise resolve', () => {
      mockAuthState.status = 'guest';
      mockPickHeroCard.mockReturnValue({ name: 'Sol Ring', reason: 'top' });
      mockUseCardThumb.mockReturnValue('sol-ring.png');
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeTruthy();
      expect(container.querySelector('.home-hero-art')).toBeNull();
      // No personal greeting/value either — same layout, generic content.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Plan your Magic: The Gathering collection' })
      ).toBeTruthy();
      expect(screen.queryByText(/Good morning/)).toBeNull();
    });
  });
});
