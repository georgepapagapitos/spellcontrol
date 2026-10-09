// @vitest-environment happy-dom
/**
 * The You page (T173): `/you` is a hub of sections, each its own route.
 *
 * Verifies:
 *  - the hub: identity first, then the section rows grouped, with a guest
 *    seeing only what works without an account;
 *  - a phone opens one section per page with a way back; a desktop keeps the
 *    list beside the open section and marks it;
 *  - every old `?section=` link and the Google link callback land on the
 *    section that now holds what they pointed at;
 *  - each section's own behavior (sign-in methods, backup and restore,
 *    the disabled-action reasons, the allocations InfoTip, Help).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal store mocks so YouPage can render without real stores. auth is a
// mutable hoisted object so a test can flip to an authed user; beforeEach
// resets it to a guest.
const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as { username: string; id: string; role?: string } | null,
    status: 'guest' as 'guest' | 'authed',
    error: null as string | null,
    profile: null as { displayName?: string | null; avatarImageUrl?: string | null } | null,
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
// Mutable like authState: the backup tests flip cards/binders between empty
// and non-empty to exercise both branches of each gate.
const { collectionState } = vi.hoisted(() => ({
  collectionState: {
    cards: [] as unknown[],
    binders: [] as unknown[],
    isRefreshingPrices: false,
    refreshPrices: vi.fn(),
    buildBackupSnapshot: vi.fn(() => ({ collection: null, binders: [] })),
    clearCards: vi.fn(),
    restoreFromBackup: vi.fn(),
  },
}));
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(collectionState),
}));
vi.mock('../store/decks', () => ({
  useDecksStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ decks: [], remapAllocations: vi.fn() }),
}));
vi.mock('../store/toasts', () => ({
  toast: { show: vi.fn() },
}));
vi.mock('@/lib/account/auth-api', () => ({
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
vi.mock('@/lib/social/friends-client', () => ({
  listFriends: vi.fn(() => Promise.resolve([])),
  listRequests: vi.fn(() => Promise.resolve({ incoming: [], outgoing: [] })),
}));
// Only the network call is stubbed — pendingPodInviteCount stays real (pure,
// no side effects) so any badge math exercised elsewhere stays honest.
vi.mock('@/lib/social/pods-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/social/pods-client')>();
  return { ...actual, listPods: vi.fn(() => Promise.resolve([])) };
});
vi.mock('@/lib/import-export/backup', () => ({
  buildBackup: vi.fn(),
  downloadBackup: vi.fn(),
  parseBackup: vi.fn(),
}));
vi.mock('@/lib/sync', () => ({ getPendingCount: () => 0 }));
vi.mock('@/lib/ai/ai-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/ai-review')>()),
  fetchAiStatus: vi.fn(() => Promise.reject(new Error('offline'))),
}));
vi.mock('@/lib/account/reset-app-cache', () => ({ resetAppCacheAndReload: vi.fn() }));
vi.mock('@/components/settings/OfflineModeSettings', () => ({
  OfflineModeSettings: () => null,
}));
vi.mock('@/components/account/SyncIndicator', () => ({
  SyncIndicator: () => null,
}));
// Has its own dedicated test file (ProfileEditor.test.tsx).
vi.mock('@/components/profile/ProfileEditor', () => ({
  ProfileEditor: () => null,
}));
vi.mock('@/lib/account/themes', () => ({
  THEMES: [{ id: 'default', name: 'Default', guild: 'None', swatch: ['#000', '#fff'] }],
}));

import { YouPage } from './YouPage';
import { LEGACY_SECTION_ROUTES } from './you/sections';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function renderYouPage(initialPath = '/you') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/you/:section?" element={<YouPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

const location = () => screen.getByTestId('location').textContent;

function signIn() {
  authState.user = { username: 'alice', id: 'u1' };
  authState.status = 'authed';
}

/** Answers every media query as a phone (`desktop: false`) or a ≥1024px window. */
function setViewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: desktop && query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}
const asDesktop = () => setViewport(true);

beforeEach(() => {
  // happy-dom's window is 1024px wide, which would make every test a desktop.
  setViewport(false);
  authState.user = null;
  authState.status = 'guest';
  authState.profile = null;
  collectionState.cards = [];
  collectionState.binders = [];
  vi.mocked(collectionState.restoreFromBackup).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T173 — the hub', () => {
  it('is titled "You" and never "Settings"', () => {
    renderYouPage();
    expect(screen.getByRole('heading', { level: 1, name: 'You' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  });

  it('shows a guest the sign-in card and only the sections that work without an account', () => {
    renderYouPage();
    expect(screen.getByText('Not signed in')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in to sync' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'You' });
    const groups = within(nav)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(groups).toEqual(['Preferences', 'Your data', 'Help']);
    expect(within(nav).queryByRole('link', { name: /Profile/ })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Friends/ })).toBeNull();
  });

  it('gives a player their account group first, and a link from their name to Profile', async () => {
    signIn();
    authState.profile = { displayName: 'Alice' };
    renderYouPage();
    const nav = screen.getByRole('navigation', { name: 'You' });
    const groups = within(nav)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(groups).toEqual(['Account', 'Preferences', 'Your data', 'Help']);
    expect(
      within(nav)
        .getByRole('link', { name: /Alice.*@alice/ })
        .getAttribute('href')
    ).toBe('/you/profile');
    expect(
      within(nav)
        .getByRole('link', { name: /^Account/ })
        .getAttribute('href')
    ).toBe('/you/account');
    // Friends is its own page; the row points there with a count.
    const friends = within(nav).getByRole('link', { name: /Friends/ });
    expect(friends.getAttribute('href')).toBe('/friends');
    await waitFor(() => expect(friends.textContent).toContain('0 friends'));
  });

  it('shows each preference row with its current value', () => {
    renderYouPage();
    const nav = screen.getByRole('navigation', { name: 'You' });
    expect(within(nav).getByRole('link', { name: /Appearance.*Default/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Prices.*USD/ })).toBeTruthy();
  });

  it('shows the AI row only when the backend offers AI, with its On/Off', async () => {
    const { fetchAiStatus } = await import('@/lib/ai/ai-review');
    vi.mocked(fetchAiStatus).mockResolvedValueOnce({ optIn: true, used: 1, limit: 10 });
    signIn();
    renderYouPage();
    const nav = screen.getByRole('navigation', { name: 'You' });
    expect(await within(nav).findByRole('link', { name: /AI.*On/ })).toBeTruthy();
  });

  it('hides the AI row when the status is unavailable', async () => {
    signIn();
    renderYouPage();
    const { fetchAiStatus } = await import('@/lib/ai/ai-review');
    await waitFor(() => expect(fetchAiStatus).toHaveBeenCalled());
    const nav = screen.getByRole('navigation', { name: 'You' });
    expect(within(nav).queryByRole('link', { name: /^AI/ })).toBeNull();
  });
});

describe('T173 — a section is its own page', () => {
  it('on a phone, opens with its own title and a way back to You', () => {
    renderYouPage('/you/appearance');
    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'You' }).getAttribute('href')).toBe('/you');
    expect(screen.queryByRole('navigation', { name: 'You' })).toBeNull();
  });

  it('on a desktop, keeps the list beside the open section and marks it', () => {
    asDesktop();
    renderYouPage('/you/prices');
    const nav = screen.getByRole('navigation', { name: 'You' });
    expect(
      within(nav)
        .getByRole('link', { name: /Prices/ })
        .getAttribute('aria-current')
    ).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Prices' })).toBeTruthy();
  });

  it('on a desktop, /you opens Profile for a player', () => {
    asDesktop();
    signIn();
    renderYouPage('/you');
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View your public profile' })).toBeTruthy();
  });

  it('on a desktop, /you opens Appearance for a guest, who has no profile', () => {
    asDesktop();
    renderYouPage('/you');
    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeTruthy();
  });

  it('sends an unknown section back to the hub', () => {
    renderYouPage('/you/bogus');
    expect(location()).toBe('/you');
  });

  it("sends a guest's Profile link to the sign-in card", () => {
    renderYouPage('/you/profile');
    expect(location()).toBe('/you/account');
    expect(screen.getByText(/sign in to sync it to your account/i)).toBeTruthy();
  });
});

describe('T173 — old links land on the section that holds what they pointed at', () => {
  it.each(Object.entries(LEGACY_SECTION_ROUTES))('?section=%s → /you/%s', (legacy, target) => {
    signIn();
    renderYouPage(`/you?section=${legacy}`);
    expect(location()).toBe(`/you/${target}`);
  });

  it('drops an unrecognized ?section= and stays on the hub', () => {
    renderYouPage('/you?section=bogus');
    expect(location()).toBe('/you');
  });

  it('carries the Google link result to Account, which toasts once and clears it', async () => {
    signIn();
    const { toast } = await import('../store/toasts');
    renderYouPage('/you?linked=google');
    await waitFor(() => expect(location()).toBe('/you/account'));
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Google account linked.' })
    );
  });
});

describe('T173 — Profile', () => {
  it('links the public profile and holds the username editor', () => {
    signIn();
    renderYouPage('/you/profile');
    expect(
      screen.getByRole('link', { name: 'View your public profile' }).getAttribute('href')
    ).toBe('/u/alice');
    expect(screen.getByRole('heading', { name: 'Username' })).toBeTruthy();
  });
});

describe('Account — sign-in methods, notifications, this device', () => {
  beforeEach(signIn);

  async function mockIdentitiesOnce(overrides: {
    password?: boolean;
    email?: string | null;
    emailVerified?: boolean;
    pendingEmail?: string | null;
    notifyEmail?: boolean;
  }) {
    const { fetchIdentities } = await import('@/lib/account/auth-api');
    vi.mocked(fetchIdentities).mockResolvedValueOnce({
      password: overrides.password ?? false,
      google: null,
      email: overrides.email ?? null,
      emailVerified: overrides.emailVerified ?? false,
      pendingEmail: overrides.pendingEmail ?? null,
      notifyEmail: overrides.notifyEmail ?? true,
    });
  }

  it('explains to a guest that local data syncs on sign-in', () => {
    authState.user = null;
    authState.status = 'guest';
    renderYouPage('/you/account');
    expect(screen.getByText(/sign in to sync it to your account/i)).toBeTruthy();
  });

  it('orders sign-in methods, notifications, this device, then Delete account', async () => {
    await mockIdentitiesOnce({ password: true });
    const { container } = renderYouPage('/you/account');
    await screen.findByRole('heading', { name: 'Sign-in methods' });
    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings).toEqual(['Sign-in methods', 'Notifications', 'This device', 'Delete account']);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('offers "Set password" for a passwordless account', async () => {
    await mockIdentitiesOnce({ password: false });
    renderYouPage('/you/account');
    expect(await screen.findByRole('button', { name: 'Set password' })).toBeTruthy();
  });

  it('offers "Change password" once the account has one', async () => {
    await mockIdentitiesOnce({ password: true });
    renderYouPage('/you/account');
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeTruthy();
  });

  it('opens the password modal and submits the new password', async () => {
    await mockIdentitiesOnce({ password: false });
    const { updatePassword } = await import('@/lib/account/auth-api');
    vi.mocked(updatePassword).mockResolvedValueOnce(undefined);
    renderYouPage('/you/account');

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
    renderYouPage('/you/account');
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
    const { resendEmailVerification } = await import('@/lib/account/auth-api');
    vi.mocked(resendEmailVerification).mockResolvedValueOnce(undefined);
    renderYouPage('/you/account');

    expect(await screen.findByText(/Pending verification, alice@example\.com/)).toBeTruthy();
    expect(
      screen.getByText('Add a verified email so you can reset your password if you get locked out.')
    ).toBeTruthy();
    // A mistyped address must be correctable while it is still pending.
    const change = screen.getByRole('button', { name: 'Change' });
    // Both buttons sit in one action group. As bare siblings, the row's
    // space-between spread them across the row with Resend in the middle.
    expect(change.parentElement?.classList.contains('settings-row-action-group')).toBe(true);
    expect(screen.getByRole('button', { name: 'Resend' }).parentElement).toBe(change.parentElement);
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(resendEmailVerification).toHaveBeenCalled());
  });

  it('shows the verified address with a Change action and drops the recovery hint', async () => {
    await mockIdentitiesOnce({
      email: 'alice@example.com',
      emailVerified: true,
      pendingEmail: null,
    });
    renderYouPage('/you/account');
    expect(await screen.findByText('alice@example.com')).toBeTruthy();
    expect(
      screen.queryByText(
        'Add a verified email so you can reset your password if you get locked out.'
      )
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('disables the Email notifications switch without a verified email', async () => {
    await mockIdentitiesOnce({ email: null, emailVerified: false, notifyEmail: true });
    renderYouPage('/you/account');
    const offSwitch = await screen.findByRole('switch', { name: 'Email notifications' });
    expect(offSwitch.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Needs a verified email.')).toBeTruthy();
  });

  it('toggles Email notifications with a verified email', async () => {
    await mockIdentitiesOnce({
      email: 'alice@example.com',
      emailVerified: true,
      notifyEmail: true,
    });
    renderYouPage('/you/account');
    const onSwitch = await screen.findByRole('switch', { name: 'Email notifications' });
    expect(onSwitch.hasAttribute('disabled')).toBe(false);
    expect(onSwitch.getAttribute('aria-checked')).toBe('true');

    const { setNotifyEmail } = await import('@/lib/account/auth-api');
    fireEvent.click(onSwitch);
    expect(onSwitch.getAttribute('aria-checked')).toBe('false'); // optimistic
    await waitFor(() => expect(setNotifyEmail).toHaveBeenCalledWith(false));
  });

  it('opens the email modal from "Add" and submits the address', async () => {
    await mockIdentitiesOnce({ email: null, emailVerified: false, pendingEmail: null });
    const { requestEmailChange } = await import('@/lib/account/auth-api');
    vi.mocked(requestEmailChange).mockResolvedValueOnce({ pendingEmail: 'alice@example.com' });
    renderYouPage('/you/account');

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('heading', { name: 'Add an email' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));

    await waitFor(() => expect(requestEmailChange).toHaveBeenCalledWith('alice@example.com'));
  });
});

describe('T173 — a disabled data action says what turns it on', () => {
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('gives backup, export and delete a reason on an empty account', () => {
    renderYouPage('/you/data');
    expect(button('Download backup').disabled).toBe(true);
    expect(screen.getByText('Needs cards, a binder or a deck.')).toBeTruthy();
    expect(button('Export').disabled).toBe(true);
    expect(button('Delete collection').disabled).toBe(true);
    expect(screen.getAllByText('Needs cards in your collection.')).toHaveLength(2);
  });

  it('gives Refresh prices a reason on an empty collection', () => {
    renderYouPage('/you/prices');
    expect(button('Refresh prices').disabled).toBe(true);
    expect(screen.getByText('Needs cards in your collection.')).toBeTruthy();
  });

  it('gives Repair a reason without cards and a deck', () => {
    renderYouPage('/you/storage');
    expect(button('Repair').disabled).toBe(true);
    expect(screen.getByText('Needs cards and a deck.')).toBeTruthy();
  });

  it('lets a backup carry binders even before any card exists', () => {
    collectionState.binders = [{ id: 'b1' }];
    renderYouPage('/you/data');
    expect(button('Download backup').disabled).toBe(false);
    expect(button('Export').disabled).toBe(true);
  });

  it('drops the reasons once there are cards', () => {
    collectionState.cards = [{ copyId: 'c1' }];
    renderYouPage('/you/data');
    expect(button('Export').disabled).toBe(false);
    expect(screen.queryByText('Needs cards in your collection.')).toBeNull();
  });
});

describe('Backup & export — restore and delete', () => {
  it('offers Restore from a backup file', () => {
    renderYouPage('/you/data');
    expect(screen.getByText('Restore from a backup file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore…' })).toBeTruthy();
  });

  it('asks before restoring over a non-empty collection', () => {
    collectionState.cards = [{ copyId: 'c1' }];
    renderYouPage('/you/data');
    fireEvent.click(screen.getByRole('button', { name: 'Restore…' }));
    expect(screen.getByRole('heading', { name: 'Restore backup?' })).toBeTruthy();
    expect(collectionState.restoreFromBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Restore backup?' })).toBeNull();
  });

  it('does not ask on an empty collection', () => {
    renderYouPage('/you/data');
    fireEvent.click(screen.getByRole('button', { name: 'Restore…' }));
    expect(screen.queryByRole('heading', { name: 'Restore backup?' })).toBeNull();
  });

  it('reads "Couldn\'t restore that backup", not the stale "import" copy, on failure', async () => {
    const { parseBackup } = await import('@/lib/import-export/backup');
    vi.mocked(parseBackup).mockImplementationOnce(() => {
      throw new Error('bad json');
    });
    const { toast } = await import('../store/toasts');
    renderYouPage('/you/data');
    const fileInput = document.querySelector('input[type="file"][accept*="json"]') as HTMLElement;
    const file = new File(['not json'], 'backup.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Couldn't restore that backup. Try again." })
      )
    );
  });

  it('keeps "Delete entire collection" with a backup reminder that names a real button', () => {
    collectionState.cards = [{ copyId: 'c1' }];
    renderYouPage('/you/data');
    expect(screen.getByText('Delete entire collection')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete collection' })).toBeTruthy();
    // It once named "Export full collection", a row with no button of that name.
    expect(screen.getByText('Download a backup first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download backup' })).toBeTruthy();
  });
});

describe('Storage and Help', () => {
  it('renders the allocations InfoTip trigger', () => {
    renderYouPage('/you/storage');
    expect(screen.getByRole('button', { name: /what is deck allocations/i })).toBeTruthy();
  });

  it('links to the static guides index and both legal pages', () => {
    renderYouPage('/you/help');
    expect(screen.getByRole('link', { name: 'Open guides' }).getAttribute('href')).toBe('/guides/');
    expect(screen.getByRole('link', { name: 'Read policy' }).getAttribute('href')).toBe(
      '/privacy.html'
    );
    expect(screen.getByRole('link', { name: 'Read terms' }).getAttribute('href')).toBe(
      '/terms.html'
    );
  });
});

describe('AI', () => {
  it('holds the consent switch when the backend offers AI', async () => {
    const { fetchAiStatus } = await import('@/lib/ai/ai-review');
    vi.mocked(fetchAiStatus).mockResolvedValueOnce({ optIn: false, used: 0, limit: 10 });
    signIn();
    renderYouPage('/you/ai');
    expect(await screen.findByRole('switch', { name: 'AI deck analysis' })).toBeTruthy();
  });

  it('tells a guest to sign in', () => {
    renderYouPage('/you/ai');
    expect(screen.getByText('Sign in to use AI deck analysis.')).toBeTruthy();
  });
});
