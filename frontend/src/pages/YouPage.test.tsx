// @vitest-environment happy-dom
/**
 * UX-332 / UX-335 — Settings page trust copy and InfoTips.
 *
 * Verifies:
 *  - UX-332: guest-state account card explains that local data merges on sign-in.
 *  - UX-335: InfoTip for "deck allocations" renders; InfoTip for "binders and lists" renders.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Minimal store mocks so YouPage can render without real stores. auth is a
// mutable hoisted object (not a fixed factory) so the new "Profile renders
// first" case below can flip to an authed user without disturbing the
// existing guest-state assertions, which reset it via afterEach.
const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as { username: string; id: string; role?: string } | null,
    status: 'guest' as 'guest' | 'authed',
    error: null as string | null,
    logout: vi.fn(),
    deleteAccount: vi.fn(),
    acknowledgeAutoLink: vi.fn(),
    clearError: vi.fn(),
  },
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) => selector(authState),
}));
vi.mock('../store/theme', () => ({
  useThemeStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'default', setTheme: vi.fn() }),
}));
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      cards: [],
      isRefreshingPrices: false,
      refreshPrices: vi.fn(),
      buildBackupSnapshot: vi.fn(() => ({ collection: null, binders: [] })),
      clearCards: vi.fn(),
    }),
}));
vi.mock('../store/decks', () => ({
  useDecksStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ decks: [], remapAllocations: vi.fn() }),
}));
vi.mock('../store/toasts', () => ({
  toast: { show: vi.fn() },
}));
vi.mock('../lib/auth-api', () => ({
  fetchIdentities: vi.fn(() => Promise.resolve(null)),
  googleLinkUrl: vi.fn(),
  requestGoogleLinkIntent: vi.fn(),
  unlinkGoogle: vi.fn(),
}));
// Only the network call is stubbed — pendingPodInviteCount stays real (pure,
// no side effects) so the "Pods" badge count is exercised for real.
vi.mock('../lib/pods-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pods-client')>();
  return { ...actual, listPods: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../lib/backup', () => ({
  buildBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('../lib/platform', () => ({ isNativePlatform: () => false }));
vi.mock('../lib/sync', () => ({ getPendingCount: () => 0 }));
vi.mock('../lib/reset-app-cache', () => ({ resetAppCacheAndReload: vi.fn() }));
vi.mock('../components/OfflineModeSettings', () => ({
  OfflineModeSettings: () => null,
}));
vi.mock('../components/SharedLinksSettings', () => ({
  SharedLinksSettings: () => null,
}));
vi.mock('../components/AdminPanel', () => ({
  AdminPanel: () => null,
}));
vi.mock('../components/SyncIndicator', () => ({
  SyncIndicator: () => null,
}));
// Both have their own dedicated test files (ProfileEditor.test.tsx,
// FriendsManagement.test.tsx) — stub them here so this file stays scoped to
// YouPage's own structure (section order, copy, InfoTips).
vi.mock('../components/ProfileEditor', () => ({
  ProfileEditor: () => null,
}));
vi.mock('../components/FriendsManagement', () => ({
  FriendsManagement: () => null,
}));
vi.mock('../lib/themes', () => ({
  THEMES: [{ id: 'default', name: 'Default', guild: 'None', swatch: ['#000', '#fff'] }],
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));

import { YouPage } from './YouPage';
import { listPods } from '../lib/pods-client';

function renderYouPage(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <YouPage />
    </MemoryRouter>
  );
}

beforeAll(() => {
  // happy-dom doesn't implement scrollIntoView; the `?section=` deep-link
  // effect (via scrollToHeading) calls it when the param matches.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  authState.user = null;
  authState.status = 'guest';
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  vi.mocked(listPods).mockReset().mockResolvedValue([]);
});

describe('UX-332 — Settings account card honesty copy', () => {
  it('explains that local data merges on sign-in when the user is not signed in', () => {
    renderYouPage();
    // The guest-state row should mention that local cards will be added to the account.
    expect(
      screen.getByText(/any cards on this device will be added to your account/i)
    ).toBeTruthy();
  });
});

describe('UX-335 — Settings InfoTips', () => {
  it('renders the allocations InfoTip trigger', () => {
    renderYouPage();
    // The InfoTip's aria-label is "What is deck allocations?"
    const tip = screen.getByRole('button', { name: /what is deck allocations/i });
    expect(tip).toBeTruthy();
  });

  it('renders the binders and lists InfoTip trigger', () => {
    renderYouPage();
    const tip = screen.getByRole('button', { name: /what is binders and lists/i });
    expect(tip).toBeTruthy();
  });
});

describe('w3-you-page — Profile carried through + Friends group inserted', () => {
  it('renders Profile first and Friends between Account and Appearance for a signed-in user', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    const { container } = renderYouPage();

    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings[0]).toBe('Profile');

    const friendsIdx = headings.indexOf('Friends');
    const accountIdx = headings.lastIndexOf('Account');
    const appearanceIdx = headings.indexOf('Appearance');
    expect(friendsIdx).toBeGreaterThan(-1);
    expect(friendsIdx).toBeGreaterThan(accountIdx);
    expect(friendsIdx).toBeLessThan(appearanceIdx);
  });
});

describe('w5-pods-index-page — Pods link + badge', () => {
  it('renders the Pods link beside the Friends heading with the pending-invite count', async () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    vi.mocked(listPods).mockResolvedValue([
      {
        id: 'p1',
        name: 'Pod A',
        ownerUserId: 'o1',
        ownerUsername: 'oscar',
        createdAt: 1,
        myStatus: 'invited',
        memberCount: 2,
      },
      {
        id: 'p2',
        name: 'Pod B',
        ownerUserId: 'o2',
        ownerUsername: 'oscar',
        createdAt: 2,
        myStatus: 'member',
        memberCount: 3,
      },
    ]);
    renderYouPage();

    const link = await screen.findByRole('link', { name: /pods, 1 pending invite/i });
    expect(link.getAttribute('href')).toBe('/pods');
    expect(link.textContent).toContain('1');
  });

  it('shows no badge when there are no pending pod invites', async () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    vi.mocked(listPods).mockResolvedValue([
      {
        id: 'p2',
        name: 'Pod B',
        ownerUserId: 'o2',
        ownerUsername: 'oscar',
        createdAt: 2,
        myStatus: 'member',
        memberCount: 3,
      },
    ]);
    renderYouPage();

    await waitFor(() => expect(listPods).toHaveBeenCalled());
    // Plain "Pods" — no aria-label override, since undefined falls back to
    // the link's own text content as its accessible name.
    const link = await screen.findByRole('link', { name: /^pods$/i });
    expect(link.getAttribute('href')).toBe('/pods');
  });
});

describe('w3-header-avatar-menu — ?section= deep link', () => {
  it('scrolls and focuses the Appearance heading for ?section=appearance', async () => {
    renderYouPage('/?section=appearance');
    const heading = screen.getByRole('heading', { name: 'Appearance' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('scrolls and focuses the Sharing heading for ?section=sharing', async () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage('/?section=sharing');
    const heading = screen.getByRole('heading', { name: 'Sharing' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('is a no-op with no section param', () => {
    renderYouPage('/');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('is a no-op for an unrecognized section value', () => {
    renderYouPage('/?section=bogus');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
