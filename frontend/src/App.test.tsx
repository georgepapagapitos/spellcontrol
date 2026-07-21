// @vitest-environment happy-dom
/**
 * Focused route-resolution test for App.tsx's "/" and "*" route elements
 * (w3-nav-activation): which element each renders across guest-fresh /
 * guest-returning / authed. Everything App mounts unconditionally on
 * mount (bootstrap, sync, offline, deep-links, the first-run gate) is
 * stubbed so this stays scoped to the routing ternaries themselves —
 * those pieces each have their own dedicated test coverage elsewhere.
 * `Navigate` is stubbed to a marker element so a redirect doesn't cascade
 * into actually mounting the target route's page tree.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...real,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  };
});

const { authState, hasEverVisitedMock } = vi.hoisted(() => ({
  authState: {
    status: 'guest' as 'guest' | 'authed',
    user: null as { id: string; username: string; role: string } | null,
    autoLinkedAt: null as number | null,
    bootstrap: vi.fn(),
  },
  hasEverVisitedMock: vi.fn(),
}));

vi.mock('./store/auth', () => ({
  useAuth: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

vi.mock('./lib/first-run', () => ({
  hasEverVisited: () => hasEverVisitedMock(),
}));

vi.mock('./lib/use-first-run-gate', () => ({
  useFirstRunGate: () => {},
}));

vi.mock('./store/collection', () => {
  const state = { hydrating: false, cards: [] as unknown[] };
  const useCollectionStore = (selector: (s: typeof state) => unknown) => selector(state);
  useCollectionStore.getState = () => ({ autoRefreshStalePrices: vi.fn() });
  return { useCollectionStore };
});

vi.mock('./lib/sync', () => ({
  startSync: vi.fn().mockResolvedValue(undefined),
  hydrateLocal: vi.fn().mockResolvedValue(undefined),
  backfillOracleIds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/offline/auto-sync', () => ({
  autoSyncOfflineData: vi.fn().mockResolvedValue(undefined),
  registerOfflineSyncOnResume: vi.fn(() => () => {}),
}));

vi.mock('./lib/deep-links', () => ({
  initDeepLinks: vi.fn(),
}));

// Layout owns nav chrome (Header/MobileTabBar/etc.) — irrelevant to route
// resolution and each piece has its own tests, so stub to just the Outlet
// the "*" route renders through.
vi.mock('./components/Layout', () => ({
  Layout: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));

vi.mock('./pages/WelcomePage', () => ({
  WelcomePage: () => <div data-testid="welcome-page" />,
}));

import App from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

afterEach(() => {
  authState.status = 'guest';
  authState.user = null;
  hasEverVisitedMock.mockReset();
});

describe('App — "/" route resolution', () => {
  it('guest, first visit (never visited) → WelcomePage', () => {
    authState.status = 'guest';
    hasEverVisitedMock.mockReturnValue(false);
    renderAt('/');
    expect(screen.getByTestId('welcome-page')).toBeTruthy();
    expect(screen.queryByTestId('navigate')).toBeNull();
  });

  it('guest, returning (has visited before) → /collection', () => {
    authState.status = 'guest';
    hasEverVisitedMock.mockReturnValue(true);
    renderAt('/');
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/collection');
    expect(screen.queryByTestId('welcome-page')).toBeNull();
  });

  it('authed → /home', () => {
    authState.status = 'authed';
    authState.user = { id: 'u1', username: 'alice', role: 'user' };
    hasEverVisitedMock.mockReturnValue(true);
    renderAt('/');
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/home');
    expect(screen.queryByTestId('welcome-page')).toBeNull();
  });
});

describe('App — "*" (unmatched path) route resolution', () => {
  it('guest → /collection', () => {
    authState.status = 'guest';
    hasEverVisitedMock.mockReturnValue(true);
    renderAt('/does-not-exist');
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/collection');
  });

  it('authed → /home', () => {
    authState.status = 'authed';
    authState.user = { id: 'u1', username: 'alice', role: 'user' };
    hasEverVisitedMock.mockReturnValue(true);
    renderAt('/does-not-exist');
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/home');
  });
});
