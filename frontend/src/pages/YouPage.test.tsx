// @vitest-environment happy-dom
/**
 * UX-332 / UX-335 — Settings page trust copy and InfoTips.
 *
 * Verifies:
 *  - UX-332: guest-state account card explains that local data merges on sign-in.
 *  - UX-335: InfoTip for "deck allocations" renders; InfoTip for "binders, lists, and decks" renders.
 *  - w7-you-ia: the page's tier hierarchy (Identity → Preferences → Your data)
 *    and the Friends pointer row that replaced the inline FriendsManagement
 *    mount now that Friends lives at its own /friends route.
 *  - you-page: the hero says "You" (the tab's word) for guest and player
 *    alike, with a meta line that names only what that reader will find;
 *    every `?section=` door lands its promised heading, and the landing is
 *    re-pinned while late cards above it are still arriving.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  requestEmailChange: vi.fn(),
  resendEmailVerification: vi.fn(),
  setNotifyEmail: vi.fn(() => Promise.resolve()),
  updatePassword: vi.fn(),
  unlinkGoogle: vi.fn(),
}));
// Backs both YouPage's own friend-count fetch and the shared
// useFriendRequests() hook (which imports listRequests from this module too).
vi.mock('../lib/friends-client', () => ({
  listFriends: vi.fn(() => Promise.resolve([])),
  listRequests: vi.fn(() => Promise.resolve({ incoming: [], outgoing: [] })),
}));
// Only the network call is stubbed — pendingPodInviteCount stays real (pure,
// no side effects) so any badge math exercised elsewhere stays honest.
vi.mock('../lib/pods-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pods-client')>();
  return { ...actual, listPods: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../lib/backup', () => ({
  buildBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('../lib/sync', () => ({ getPendingCount: () => 0 }));
vi.mock('../lib/reset-app-cache', () => ({ resetAppCacheAndReload: vi.fn() }));
vi.mock('../components/OfflineModeSettings', () => ({
  OfflineModeSettings: () => null,
}));
vi.mock('../components/SharedLinksSettings', () => ({
  SharedLinksSettings: () => null,
}));
vi.mock('../components/SyncIndicator', () => ({
  SyncIndicator: () => null,
}));
// Has its own dedicated test file (ProfileEditor.test.tsx) — stub it here so
// this file stays scoped to YouPage's own structure (section order, copy,
// InfoTips). FriendsManagement no longer mounts on this page at all (it
// moved to FriendsPage.test.tsx along with the Pods-link tests).
vi.mock('../components/ProfileEditor', () => ({
  ProfileEditor: () => null,
}));
vi.mock('../lib/themes', () => ({
  THEMES: [{ id: 'default', name: 'Default', guild: 'None', swatch: ['#000', '#fff'] }],
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

beforeEach(() => {
  authState.user = null;
  authState.status = 'guest';
});

afterEach(() => {
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

describe('UX-332 — Settings account card honesty copy', () => {
  it('explains that local data merges on sign-in when the user is not signed in', () => {
    renderYouPage();
    // The guest-state row should mention that local cards will be added to the account.
    expect(screen.getByText(/sync the cards here into your account/i)).toBeTruthy();
  });
});

describe('UX-335 — Settings InfoTips', () => {
  it('renders the allocations InfoTip trigger', () => {
    renderYouPage();
    // The InfoTip's aria-label is "What is deck allocations?"
    const tip = screen.getByRole('button', { name: /what is deck allocations/i });
    expect(tip).toBeTruthy();
  });

  it('renders the binders, lists, and decks InfoTip trigger', () => {
    renderYouPage();
    const tip = screen.getByRole('button', { name: /what is binders, lists, and decks/i });
    expect(tip).toBeTruthy();
  });
});

describe('w7-you-ia — tier hierarchy', () => {
  it('orders Identity → Preferences → Your data, with Profile first and Friends inside Identity', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    const { container } = renderYouPage();

    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    const idx = (text: string) => headings.indexOf(text);

    expect(idx('Identity')).toBe(0);
    expect(idx('Profile')).toBeGreaterThan(idx('Identity'));
    expect(idx('Account')).toBeGreaterThan(idx('Profile'));
    expect(idx('Friends')).toBeGreaterThan(idx('Account'));
    expect(idx('Preferences')).toBeGreaterThan(idx('Friends'));
    expect(idx('Appearance')).toBeGreaterThan(idx('Preferences'));
    expect(idx('Your data')).toBeGreaterThan(idx('Appearance'));
    expect(idx('Collection')).toBeGreaterThan(idx('Your data'));
    expect(idx('Danger zone')).toBeGreaterThan(idx('Collection'));
  });

  it('every group keeps a visible heading — none fall back to sr-only', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    const { container } = renderYouPage();

    const groupHeadings = container.querySelectorAll(
      'h2.settings-section-header, h2.settings-tier-header'
    );
    expect(groupHeadings.length).toBeGreaterThan(0);
    groupHeadings.forEach((h) => expect(h.className).not.toContain('sr-only'));
  });
});

describe('w7-you-ia — Friends pointer', () => {
  it('links to /friends with a summary, not the full FriendsManagement UI', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage();

    const link = screen.getByRole('link', { name: /manage friends/i });
    expect(link.getAttribute('href')).toBe('/friends');
    // The old inline mount rendered a 4-tab strip; that must be gone from /you.
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('is absent for guests', () => {
    renderYouPage();
    expect(screen.queryByRole('link', { name: /manage friends/i })).toBeNull();
  });
});

describe('you-page — hero copy', () => {
  it('is titled "You" for a guest, with a meta line that does not promise a Profile card', () => {
    renderYouPage();
    expect(screen.getByRole('heading', { level: 1, name: 'You' })).toBeTruthy();
    expect(screen.getByText('Account, appearance, and data tools.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Profile' })).toBeNull();
  });

  it('is titled "You" for a signed-in player, with Profile named in the meta line', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage();
    expect(screen.getByRole('heading', { level: 1, name: 'You' })).toBeTruthy();
    expect(screen.getByText('Profile, account, appearance, and data tools.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
  });

  it('links the Profile card to the public profile', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage();
    const link = screen.getByRole('link', { name: 'public profile' });
    expect(link.getAttribute('href')).toBe('/u/alice');
  });

  it('never calls the page Settings', () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    // The Danger zone's backup hint names the card, not a page called Settings.
    expect(
      screen.getByText(/Make a backup first: Collection → Export full collection/)
    ).toBeTruthy();
  });
});

describe('you-page — every door lands its promised heading', () => {
  const signedInDoors: Array<[string, string]> = [
    ['profile', 'Profile'],
    ['account', 'Account'],
    ['settings', 'Preferences'],
    ['sharing', 'Sharing'],
    ['danger', 'Danger zone'],
  ];

  it.each(signedInDoors)('?section=%s focuses the "%s" heading', async (section, heading) => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage(`/?section=${section}`);
    const target = screen.getByRole('heading', { name: heading });
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('?section=account lands the guest on the Not signed in card', async () => {
    renderYouPage('/?section=account');
    const target = screen.getByRole('heading', { name: 'Account' });
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(screen.getByRole('link', { name: 'Sign in to sync' })).toBeTruthy();
  });
});

describe('you-page — the landing is re-pinned while late cards arrive', () => {
  type ResizeCb = () => void;
  let callbacks: ResizeCb[];
  let disconnects: number;
  const OriginalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    callbacks = [];
    disconnects = 0;
    class FakeResizeObserver {
      constructor(cb: ResizeCb) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects += 1;
      }
    }
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = OriginalResizeObserver;
  });

  it('scrolls the target again on a layout change, without moving focus a second time', async () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage('/?section=appearance');
    const heading = screen.getByRole('heading', { name: 'Appearance' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(callbacks).toHaveLength(1);
    const scrolls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;

    // Move focus the way a fast user would, then let a card above grow.
    screen.getByRole('button', { name: 'Sign out' }).focus();
    act(() => callbacks[0]());

    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(scrolls + 1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign out' }));
  });

  it('?section=sign-in announces the Sign-in methods card on the pass that first finds it', async () => {
    const { fetchIdentities } = await import('../lib/auth-api');
    vi.mocked(fetchIdentities).mockResolvedValueOnce({
      password: true,
      google: null,
      email: null,
      emailVerified: false,
      pendingEmail: null,
      notifyEmail: true,
    });
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage('/?section=sign-in');
    // Mount: the card isn't there yet, so nothing scrolled and nothing took focus.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    const target = await screen.findByRole('heading', { name: 'Sign-in methods' });
    expect(callbacks).toHaveLength(1);
    act(() => callbacks[0]());
    expect(document.activeElement).toBe(target);
    // A second layout change re-pins but leaves focus where it is.
    screen.getByRole('button', { name: 'Sign out' }).focus();
    act(() => callbacks[0]());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign out' }));
  });

  it('stops re-pinning as soon as the user starts interacting', async () => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
    renderYouPage('/?section=appearance');
    await waitFor(() => expect(callbacks).toHaveLength(1));
    const before = disconnects;
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(disconnects).toBeGreaterThan(before);
  });

  it('does not observe at all without a section param', () => {
    renderYouPage('/');
    expect(callbacks).toHaveLength(0);
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

describe('T117 — Help & guides', () => {
  it('links to the static guides index', () => {
    renderYouPage();
    const link = screen.getByRole('link', { name: 'Open guides' });
    expect(link.getAttribute('href')).toBe('/guides/');
  });
});

describe('T117 — Sign-in methods: Password and Email rows', () => {
  beforeEach(() => {
    authState.user = { username: 'alice', id: 'u1' };
    authState.status = 'authed';
  });

  async function mockIdentitiesOnce(overrides: {
    password?: boolean;
    email?: string | null;
    emailVerified?: boolean;
    pendingEmail?: string | null;
    notifyEmail?: boolean;
  }) {
    const { fetchIdentities } = await import('../lib/auth-api');
    vi.mocked(fetchIdentities).mockResolvedValueOnce({
      password: overrides.password ?? false,
      google: null,
      email: overrides.email ?? null,
      emailVerified: overrides.emailVerified ?? false,
      pendingEmail: overrides.pendingEmail ?? null,
      notifyEmail: overrides.notifyEmail ?? true,
    });
  }

  it('offers "Set password" for a passwordless account', async () => {
    await mockIdentitiesOnce({ password: false });
    renderYouPage('/?section=sign-in');
    expect(await screen.findByRole('button', { name: 'Set password' })).toBeTruthy();
  });

  it('offers "Change password" once the account has one', async () => {
    await mockIdentitiesOnce({ password: true });
    renderYouPage('/?section=sign-in');
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeTruthy();
  });

  it('opens the password modal and submits the new password', async () => {
    await mockIdentitiesOnce({ password: false });
    const { updatePassword } = await import('../lib/auth-api');
    vi.mocked(updatePassword).mockResolvedValueOnce(undefined);
    renderYouPage('/?section=sign-in');

    fireEvent.click(await screen.findByRole('button', { name: 'Set password' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Set a password' })).toBeTruthy();
    // No "current password" field for a passwordless account.
    expect(within(dialog).queryByLabelText('Current password')).toBeNull();

    // The New/Confirm fields both wrap a trailing requirements <ul>, so
    // getByLabelText's aggregated-text match can't isolate either one (same
    // reason ResetPasswordPage.test.tsx selects by input, not label).
    const [password, confirm] = Array.from(
      dialog.querySelectorAll<HTMLInputElement>('input[type="password"]')
    );
    fireEvent.change(password, { target: { value: 'a brand new password' } });
    fireEvent.change(confirm, { target: { value: 'a brand new password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set password' }));

    await waitFor(() =>
      expect(updatePassword).toHaveBeenCalledWith({
        currentPassword: undefined,
        newPassword: 'a brand new password',
      })
    );
  });

  it('shows "Not set" with the recovery hint, and no verified email exists yet', async () => {
    // password: true so the Password row's own "Set" hint doesn't collide
    // with the Email row's "Not set" — this test is about the Email row.
    await mockIdentitiesOnce({
      password: true,
      email: null,
      emailVerified: false,
      pendingEmail: null,
    });
    renderYouPage('/?section=sign-in');
    expect(await screen.findByText('Not set')).toBeTruthy();
    expect(
      screen.getByText('Add a verified email so you can reset your password if you get locked out.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('shows "Pending verification" with a Resend action, still with the recovery hint', async () => {
    await mockIdentitiesOnce({
      email: null,
      emailVerified: false,
      pendingEmail: 'alice@example.com',
    });
    const { resendEmailVerification } = await import('../lib/auth-api');
    vi.mocked(resendEmailVerification).mockResolvedValueOnce(undefined);
    renderYouPage('/?section=sign-in');

    expect(await screen.findByText(/Pending verification, alice@example\.com/)).toBeTruthy();
    expect(
      screen.getByText('Add a verified email so you can reset your password if you get locked out.')
    ).toBeTruthy();
    // A mistyped address must be correctable while it is still pending.
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(resendEmailVerification).toHaveBeenCalled());
  });

  it('shows the verified address with a Change action and drops the recovery hint', async () => {
    await mockIdentitiesOnce({
      email: 'alice@example.com',
      emailVerified: true,
      pendingEmail: null,
    });
    renderYouPage('/?section=sign-in');
    expect(await screen.findByText('alice@example.com')).toBeTruthy();
    expect(
      screen.queryByText(
        'Add a verified email so you can reset your password if you get locked out.'
      )
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('T117 — Email notifications switch is disabled without a verified email', async () => {
    await mockIdentitiesOnce({ email: null, emailVerified: false, notifyEmail: true });
    renderYouPage('/?section=sign-in');
    const offSwitch = await screen.findByRole('switch', { name: 'Email notifications' });
    expect(offSwitch.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Add a verified email above to get these.')).toBeTruthy();
  });

  it('T117 — Email notifications switch is enabled and toggles with a verified email', async () => {
    await mockIdentitiesOnce({
      email: 'alice@example.com',
      emailVerified: true,
      notifyEmail: true,
    });
    renderYouPage('/?section=sign-in');
    const onSwitch = await screen.findByRole('switch', { name: 'Email notifications' });
    expect(onSwitch.hasAttribute('disabled')).toBe(false);
    expect(onSwitch.getAttribute('aria-checked')).toBe('true');

    const { setNotifyEmail } = await import('../lib/auth-api');
    fireEvent.click(onSwitch);
    expect(onSwitch.getAttribute('aria-checked')).toBe('false'); // optimistic
    await waitFor(() => expect(setNotifyEmail).toHaveBeenCalledWith(false));
  });

  it('opens the email modal from "Add" and submits the address', async () => {
    await mockIdentitiesOnce({ email: null, emailVerified: false, pendingEmail: null });
    const { requestEmailChange } = await import('../lib/auth-api');
    vi.mocked(requestEmailChange).mockResolvedValueOnce({ pendingEmail: 'alice@example.com' });
    renderYouPage('/?section=sign-in');

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('heading', { name: 'Add an email' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));

    await waitFor(() => expect(requestEmailChange).toHaveBeenCalledWith('alice@example.com'));
  });
});
