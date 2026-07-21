// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockUseActivity = vi.fn();
vi.mock('../lib/use-activity', () => ({
  useActivity: () => mockUseActivity(),
}));

interface MockAuthState {
  status: 'guest' | 'authed';
  user: { id: string; username: string } | null;
  profile: { displayName: string | null; avatarImageUrl: string | null } | null;
}
let authState: MockAuthState = { status: 'guest', user: null, profile: null };
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: MockAuthState) => unknown) => selector(authState),
}));

vi.mock('../store/play', () => ({
  usePlayStore: (selector: (s: { local: unknown; online: unknown }) => unknown) =>
    selector({ local: null, online: null }),
}));

import { MobileTabBar } from './MobileTabBar';

function renderBar() {
  return render(
    <MemoryRouter>
      <MobileTabBar />
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState = { status: 'guest', user: null, profile: null };
  mockUseActivity.mockReset();
  mockUseActivity.mockReturnValue({ count: 0, actionRequired: [], recent: [], loading: false });
});

describe('MobileTabBar', () => {
  it('renders exactly 5 primary destinations in DOM order, plus the Search utility', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Primary mobile' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/home',
      '/collection',
      '/decks',
      '/play',
      '/you',
      '/search',
    ]);
  });

  it('drops Rules, Friends, and Settings entirely', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /Rules/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Friends/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull();
  });

  it('styles the Search icon as a distinct utility, not a 6th primary tab', () => {
    renderBar();
    const search = screen.getByRole('link', { name: 'Search' });
    expect(search.className).toContain('mobile-tab-bar-search');
    expect(search.className).not.toContain('mobile-tab-bar-link');
    expect(search.querySelector('.mobile-tab-bar-label')).toBeNull();
  });

  it('renders no badge on Home when the activity count is zero', () => {
    renderBar();
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home.querySelector('.mobile-tab-bar-badge')).toBeNull();
  });

  it('badges Home with the count and singular aria-label template', () => {
    mockUseActivity.mockReturnValue({ count: 1, actionRequired: [], recent: [], loading: false });
    renderBar();
    const home = screen.getByRole('link', { name: 'Home, 1 notification' });
    expect(home.querySelector('.mobile-tab-bar-badge')?.textContent).toBe('1');
  });

  it('badges Home with the count and plural aria-label template', () => {
    mockUseActivity.mockReturnValue({ count: 3, actionRequired: [], recent: [], loading: false });
    renderBar();
    expect(screen.getByRole('link', { name: 'Home, 3 notifications' })).toBeTruthy();
  });

  it('caps the Home badge display at 9+ without capping the aria-label count', () => {
    mockUseActivity.mockReturnValue({ count: 12, actionRequired: [], recent: [], loading: false });
    renderBar();
    const home = screen.getByRole('link', { name: 'Home, 12 notifications' });
    expect(home.querySelector('.mobile-tab-bar-badge')?.textContent).toBe('9+');
  });

  it('never renders a badge on any tab other than Home', () => {
    mockUseActivity.mockReturnValue({ count: 5, actionRequired: [], recent: [], loading: false });
    renderBar();
    for (const name of ['Collection', 'Decks', 'Play']) {
      expect(screen.getByRole('link', { name }).querySelector('.mobile-tab-bar-badge')).toBeNull();
    }
  });

  it('shows a generic guest icon on You, and You remains present for guests', () => {
    renderBar();
    const you = screen.getByRole('link', { name: 'You' });
    expect(you.querySelector('.user-avatar')).toBeNull();
    expect(you.querySelector('.mobile-tab-bar-icon')).toBeTruthy();
  });

  it('shows UserAvatar with the profile image when authed', () => {
    authState = {
      status: 'authed',
      user: { id: 'u1', username: 'georgep' },
      profile: { displayName: 'George', avatarImageUrl: 'https://img.example/avatar.png' },
    };
    renderBar();
    const you = screen.getByRole('link', { name: 'You, signed in as @georgep' });
    const img = you.querySelector('img.user-avatar') as HTMLImageElement | null;
    expect(img?.src).toBe('https://img.example/avatar.png');
  });
});
