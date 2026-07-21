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
