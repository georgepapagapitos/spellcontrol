// @vitest-environment happy-dom
/**
 * Header — desktop nav-links (Home/Collection/Decks/Play; Friends folded into
 * You), Search, and the right cluster's authed-only avatar account menu vs.
 * the guest "Sign in" link. Rules is removed entirely from this surface (see
 * w3-mobile-native-nav for its PlayPage relocation, out of this PR's scope).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

// Mutable hoisted auth/activity state so individual tests can flip
// authed/guest and the badge count; afterEach resets both to the defaults.
const { authState, activityState } = vi.hoisted(() => ({
  authState: {
    status: 'guest' as 'guest' | 'authed',
    user: null as { username: string } | null,
    profile: null as { displayName: string | null; avatarImageUrl: string | null } | null,
    logout: vi.fn(),
  },
  activityState: { count: 0 },
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: typeof authState) => unknown) => selector(authState),
}));
vi.mock('../lib/use-activity', () => ({
  useActivity: () => activityState,
}));
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: unknown[] }) => unknown) => selector({ cards: [] }),
}));
vi.mock('../store/decks', () => ({
  useDecksStore: (selector: (s: { decks: unknown[] }) => unknown) => selector({ decks: [] }),
}));
vi.mock('../store/play', () => ({
  usePlayStore: (selector: (s: { local: unknown; online: unknown }) => unknown) =>
    selector({ local: null, online: null }),
}));
vi.mock('./SyncIndicator', () => ({
  HeaderSyncIndicator: () => null,
}));

import { Header } from './Header';

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );
}

afterEach(() => {
  authState.status = 'guest';
  authState.user = null;
  authState.profile = null;
  activityState.count = 0;
  navigateMock.mockClear();
  authState.logout.mockClear();
});

describe('Header — nav links', () => {
  it('renders Home, Collection, Decks, Play and excludes Friends', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /^home$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^collection$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^decks$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^play$/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /friends/i })).toBeNull();
  });

  it('Home has no notification aria-label when the activity count is zero', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /^home$/i }).getAttribute('aria-label')).toBeNull();
  });

  it('Home gets the count-aware aria-label and badge when the count is positive (plural)', () => {
    activityState.count = 3;
    renderHeader();
    expect(screen.getByRole('link', { name: 'Home, 3 notifications' })).toBeTruthy();
  });

  it('singularizes the aria-label for exactly 1', () => {
    activityState.count = 1;
    renderHeader();
    expect(screen.getByRole('link', { name: 'Home, 1 notification' })).toBeTruthy();
  });

  it('renders no Rules control', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /rules/i })).toBeNull();
    expect(screen.queryByText(/^rules$/i)).toBeNull();
  });
});

describe('Header — guest', () => {
  it('renders a plain "Sign in" link to /you, not an avatar menu', () => {
    renderHeader();
    const signIn = screen.getByRole('link', { name: /^sign in$/i });
    expect(signIn.getAttribute('href')).toBe('/you');
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
  });
});

describe('Header — authed avatar menu', () => {
  function signIn() {
    authState.status = 'authed';
    authState.user = { username: 'alice' };
    authState.profile = { displayName: null, avatarImageUrl: null };
  }

  it('renders no guest Sign in link', () => {
    signIn();
    renderHeader();
    expect(screen.queryByRole('link', { name: /^sign in$/i })).toBeNull();
  });

  it('opens to exactly 4 items in order: Profile, Settings, Shared links, Sign out', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Profile',
      'Settings',
      'Shared links',
      'Sign out',
    ]);
  });

  it('Profile navigates to /you', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(navigateMock).toHaveBeenCalledWith('/you');
  });

  it('Settings navigates to /you?section=appearance', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(navigateMock).toHaveBeenCalledWith('/you?section=appearance');
  });

  it('Shared links navigates to /you?section=sharing', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shared links' }));
    expect(navigateMock).toHaveBeenCalledWith('/you?section=sharing');
  });

  it('Sign out calls logout()', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(authState.logout).toHaveBeenCalledOnce();
  });
});
