// @vitest-environment happy-dom
/**
 * FriendsPage — the /friends destination. Owns the page heading and renders
 * the shared SocialHubTabs strip (Friends / Trades / Pods, with the pods
 * pending-invite count chip); the social mechanics (search, requests, inbox,
 * activity, the guest sign-in gate) all live in FriendsManagement, which has
 * its own dedicated test file and is stubbed here so this file stays scoped
 * to the page shell.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { status: 'authed' as 'authed' | 'guest' },
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string; user: { username: string } | null }) => unknown) =>
    selector({
      status: authState.status,
      user: authState.status === 'authed' ? { username: 'alice' } : null,
    }),
}));

vi.mock('../components/FriendsManagement', () => ({
  FriendsManagement: () => <div data-testid="friends-management-stub" />,
}));

vi.mock('../lib/pods-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pods-client')>();
  return { ...actual, listPods: vi.fn(() => Promise.resolve([])) };
});

import { FriendsPage } from './FriendsPage';
import { listPods, type Pod } from '../lib/pods-client';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/friends']}>
      <FriendsPage />
    </MemoryRouter>
  );
}

function pod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: 'p1',
    name: 'Pod A',
    ownerUserId: 'o1',
    ownerUsername: 'oscar',
    createdAt: 1,
    myStatus: 'invited',
    memberCount: 2,
    ...overrides,
  };
}

beforeEach(() => {
  authState.status = 'authed';
  vi.mocked(listPods).mockReset().mockResolvedValue([]);
});

describe('FriendsPage', () => {
  it('renders the page heading and mounts FriendsManagement', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Friends' })).toBeTruthy();
    expect(screen.getByTestId('friends-management-stub')).toBeTruthy();
  });

  it('renders a plain "Pods" link with no badge when there are no pending invites', async () => {
    renderPage();
    await waitFor(() => expect(listPods).toHaveBeenCalled());
    const link = await screen.findByRole('link', { name: /^pods$/i });
    expect(link.getAttribute('href')).toBe('/pods');
  });

  it('badges the Pods tab with the pending-invite count', async () => {
    vi.mocked(listPods).mockResolvedValue([
      pod({ id: 'p1', myStatus: 'invited' }),
      pod({ id: 'p2', myStatus: 'member' }),
    ]);
    renderPage();

    const link = await screen.findByRole('link', { name: /pods 1 invites awaiting your reply/i });
    expect(link.getAttribute('href')).toBe('/pods');
    expect(link.textContent).toContain('1');
  });

  it('shows the Pods link for guests too, without fetching pod invites', () => {
    authState.status = 'guest';
    renderPage();
    const link = screen.getByRole('link', { name: /^pods$/i });
    expect(link.getAttribute('href')).toBe('/pods');
    expect(listPods).not.toHaveBeenCalled();
  });
});
