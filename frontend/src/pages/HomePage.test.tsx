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
const mockPickHeroCardName = vi.hoisted(() => vi.fn(() => null as string | null));
vi.mock('../lib/home-hero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/home-hero')>();
  return { ...actual, pickHeroCardName: mockPickHeroCardName, heroGreeting: () => 'Good morning' };
});

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: mockUseCardThumb }));

import { HomePage } from './HomePage';

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
  mockPickHeroCardName.mockReturnValue(null);
  mockUseCardThumb.mockReturnValue(undefined);
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

  describe('hero background', () => {
    it('shows the brand fallback (no art) for a brand-new empty collection', () => {
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeTruthy();
      expect(container.querySelector('.home-hero-art')).toBeNull();
      expect(container.querySelector('.home-hero-caption')).toBeNull();
    });

    it('shows collection art + the "from your collection" caption once a hero card resolves', () => {
      mockPickHeroCardName.mockReturnValue('Sol Ring');
      mockUseCardThumb.mockReturnValue('sol-ring.png');
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeNull();
      const img = container.querySelector('.home-hero-art') as HTMLImageElement | null;
      expect(img?.getAttribute('src')).toBe('sol-ring.png');
      expect(img?.getAttribute('alt')).toBe('');
      expect(screen.getByText('Sol Ring — from your collection')).toBeTruthy();
    });

    it('never shows personal art for a guest, even if a hero card would otherwise resolve', () => {
      mockAuthState.status = 'guest';
      mockPickHeroCardName.mockReturnValue('Sol Ring');
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
