// @vitest-environment happy-dom
/**
 * Header — desktop nav-links (Home/Collection/Decks/Play/Social), the
 * Search + Rules utility links, and the right cluster's authed-only avatar
 * account menu vs. the guest "Sign in" link. Rules is a link to the /rules
 * page here (the quick-look sheet stays on Play and the in-game menu).
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
  // `count` drives Home's badge (all activity); `actionRequired` drives
  // Friends' (the answerable subset). Both come off the one useActivity()
  // bucket, so a test can't set them into a state the app can't reach.
  activityState: { count: 0, actionRequired: [] as { type: string }[] },
}));
vi.mock('@/store/auth', () => ({
  useAuth: (selector: (s: typeof authState) => unknown) => selector(authState),
}));
vi.mock('@/lib/social/use-activity', () => ({
  useActivity: () => activityState,
}));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: unknown[] }) => unknown) => selector({ cards: [] }),
}));
const { decksState } = vi.hoisted(() => ({ decksState: { decks: [] as unknown[] } }));
vi.mock('@/store/decks', () => ({
  useDecksStore: (selector: (s: { decks: unknown[] }) => unknown) => selector(decksState),
}));
vi.mock('@/store/play', () => ({
  usePlayStore: (selector: (s: { local: unknown; online: unknown }) => unknown) =>
    selector({ local: null, online: null }),
}));
vi.mock('@/components/account/SyncIndicator', () => ({
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
  activityState.actionRequired = [];
  navigateMock.mockClear();
  authState.logout.mockClear();
});

describe('Header — nav counts', () => {
  it('compacts the deck count the same way as the card count', () => {
    decksState.decks = Array.from({ length: 1500 }, () => ({}));
    try {
      renderHeader();
      expect(screen.getByLabelText('1500 decks').textContent).toBe('1.5k');
    } finally {
      decksState.decks = [];
    }
  });
});

describe('Header — nav links', () => {
  // Friends is back in the primary nav, reversing nav v2's omission. That
  // omission rested on "friends management lives inside /you", a premise
  // #1474 deleted when it made /friends a real page again and dropped the
  // /you redirect — leaving /friends, /trades, /pods and /friends/:id as the
  // app's only page cluster with no top-level door. This assertion used to
  // read `excludes Friends`; it is inverted deliberately, not by accident.
  // The link reads "Social" (E558): it opens the hub holding Friends, Trades
  // and Pods, and a primary nav link names its hub the way Collection and
  // Decks do, while the hub's first tab keeps the section name.
  it('renders Home, Collection, Decks, Play, Daily and Social, in that order', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /^home$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^collection$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^decks$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^play$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^daily$/i }).getAttribute('href')).toBe('/daily');
    expect(screen.getByRole('link', { name: /^social$/i }).getAttribute('href')).toBe('/friends');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const labels = Array.from(nav.querySelectorAll('.site-nav-link')).map((a) => a.textContent);
    expect(labels.indexOf('Daily')).toBe(labels.indexOf('Play') + 1);
  });

  it('Social has no waiting aria-label when nothing needs an answer', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /^social$/i }).getAttribute('aria-label')).toBeNull();
  });

  it('Social badges only the action-required subset, not the whole activity count', () => {
    // 5 notifications total, but only 2 are answerable on a social page —
    // the badge must show 2, or it sends users to /friends for a deck like.
    activityState.count = 5;
    activityState.actionRequired = [{ type: 'friend_request' }, { type: 'trade_offer' }];
    renderHeader();
    expect(screen.getByRole('link', { name: 'Social, 2 waiting on you' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home, 5 notifications' })).toBeTruthy();
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

  it('renders Rules as a utility link to /rules beside Search, not a sheet button', () => {
    renderHeader();
    const rules = screen.getByRole('link', { name: 'Rules' });
    expect(rules.getAttribute('href')).toBe('/rules');
    expect(rules.className).toContain('site-nav-settings');
    // A link to the page, never the old in-header sheet trigger.
    expect(screen.queryByRole('button', { name: /rules/i })).toBeNull();
    // Still not a primary hub link.
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(primary.textContent).not.toMatch(/Rules/);
  });
});

describe('Header — guest', () => {
  it('renders a plain "Sign in" link to /auth, not an avatar menu', () => {
    renderHeader();
    const signIn = screen.getByRole('link', { name: /^sign in$/i });
    // Rendered at "/" there is nothing to return to, so no returnTo.
    expect(signIn.getAttribute('href')).toBe('/auth');
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
  });

  it('renders a Settings gear to the Preferences tier of /you — the desktop guest door', () => {
    renderHeader();
    const gear = screen.getByRole('link', { name: 'Settings' });
    expect(gear.getAttribute('href')).toBe('/you/appearance');
  });
});

describe('Header — authed avatar menu', () => {
  function signIn() {
    authState.status = 'authed';
    authState.user = { username: 'alice' };
    authState.profile = { displayName: null, avatarImageUrl: null };
  }

  it('renders no guest Sign in link and no guest Settings gear', () => {
    signIn();
    renderHeader();
    expect(screen.queryByRole('link', { name: /^sign in$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('opens to exactly 4 items in order: Profile, Settings, Public profile, Sign out', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Profile',
      'Settings',
      'Public profile',
      'Sign out',
    ]);
  });

  // Three doors, one page: each menu item is a `?section=` jump so the
  // heading it promised lands at the top of the viewport (YouPage pins it).
  it('Profile navigates to /you/profile', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(navigateMock).toHaveBeenCalledWith('/you/profile');
  });

  it('Settings navigates to /you/appearance', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(navigateMock).toHaveBeenCalledWith('/you/appearance');
  });

  it('Public profile navigates to the page everyone else sees', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Public profile' }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringMatching(/^\/u\//));
  });

  it('Sign out calls logout()', () => {
    signIn();
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(authState.logout).toHaveBeenCalledOnce();
  });
});

describe('Header — the wordmark', () => {
  it('goes Home, like the first nav item, and never claims to be the current page', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Header />
      </MemoryRouter>
    );
    const brand = screen.getByRole('link', { name: 'SpellControl' });
    expect(brand.getAttribute('href')).toBe('/home');
    expect(brand.getAttribute('aria-current')).toBeNull();
  });

  // The app ships without a logo for now: the name is the whole brand.
  it('is the name as text, with no logo image', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Header />
      </MemoryRouter>
    );
    const brand = screen.getByRole('link', { name: 'SpellControl' });
    expect(brand.textContent).toBe('SpellControl');
    expect(brand.querySelector('svg, img')).toBeNull();
  });
});
