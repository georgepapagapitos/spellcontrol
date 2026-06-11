// @vitest-environment happy-dom
/**
 * UX-332 / UX-335 / UX-336 — Settings page trust copy, InfoTips, and brand moment.
 *
 * Verifies:
 *  - UX-332: guest-state account card explains that local data merges on sign-in.
 *  - UX-335: InfoTip for "deck allocations" renders; InfoTip for "binders and lists" renders.
 *  - UX-336: brand moment (settings-brand-moment) renders with product name.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Minimal store mocks so SettingsPage can render without real stores.
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      user: null,
      status: 'guest',
      error: null,
      logout: vi.fn(),
      deleteAccount: vi.fn(),
      acknowledgeAutoLink: vi.fn(),
      clearError: vi.fn(),
    }),
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
vi.mock('../lib/themes', () => ({
  THEMES: [{ id: 'default', name: 'Default', guild: 'None', swatch: ['#000', '#fff'] }],
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));

import { SettingsPage } from './SettingsPage';

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe('UX-336 — Settings brand moment', () => {
  it('renders a brand moment element with the product name', () => {
    const { container } = renderSettings();
    const moment = container.querySelector('.settings-brand-moment');
    expect(moment).toBeTruthy();
    expect(moment?.textContent).toContain('SpellControl');
  });
});

describe('UX-332 — Settings account card honesty copy', () => {
  it('explains that local data merges on sign-in when the user is not signed in', () => {
    renderSettings();
    // The guest-state row should mention that local cards will be added to the account.
    expect(
      screen.getByText(/any cards on this device will be added to your account/i)
    ).toBeTruthy();
  });
});

describe('UX-335 — Settings InfoTips', () => {
  it('renders the allocations InfoTip trigger', () => {
    renderSettings();
    // The InfoTip's aria-label is "What is deck allocations?"
    const tip = screen.getByRole('button', { name: /what is deck allocations/i });
    expect(tip).toBeTruthy();
  });

  it('renders the binders and lists InfoTip trigger', () => {
    renderSettings();
    const tip = screen.getByRole('button', { name: /what is binders and lists/i });
    expect(tip).toBeTruthy();
  });
});
