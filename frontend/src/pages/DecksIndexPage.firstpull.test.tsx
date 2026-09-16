// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /decks must not claim you have no decks while the first pull is in flight.
 *
 * The defect (playtest batch 5, 2026-09-16): a cold arrival rendered the full
 * three-CTA "No decks yet" pitch for **1380ms** on an account with nine decks.
 * Measured transition, `.claude/tools/b5-empty-flash.mjs`, phone, cold context:
 *
 *   t= 268ms  spinner                                        correct
 *   t= 542ms  "Decks · 0 decks · No decks yet. Build one…"    the lie
 *   t=1790ms  "9 decks", 109 card nodes
 *
 * The page stops showing a loader and starts ASSERTING emptiness, because
 * `hydrating` only covers reading IndexedDB — on a device that has never cached
 * the account that read finds nothing and completes immediately.
 *
 * Every pre-existing test for this page starts with the store populated or with
 * sync already 'ready', so none of them could reach this window. This drives it
 * directly, and is the page-level half of the guard (the hook's own unit tests
 * live in lib/use-awaiting-first-pull.test.tsx).
 */

const syncMock = vi.hoisted(() => ({
  state: 'syncing' as 'idle' | 'syncing' | 'ready',
  error: false,
}));
vi.mock('../lib/sync', () => ({
  getSyncState: () => syncMock.state,
  hasSyncError: () => syncMock.error,
  onSyncedChange: () => () => {},
  getPendingCount: () => 0,
  isOnline: () => true,
  getLastSyncedAt: () => null,
  isApplyingServer: () => false,
}));

const authMock = vi.hoisted(() => ({ status: 'authed' as 'authed' | 'guest' }));
vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: authMock.status }),
}));

import { DecksIndexPage } from './DecksIndexPage';
import { useDecksStore } from '../store/decks';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/decks']}>
      <DecksIndexPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  syncMock.state = 'syncing';
  syncMock.error = false;
  authMock.status = 'authed';
  useDecksStore.setState({ decks: [] });
});

describe('/decks during the first pull', () => {
  it('does NOT say "No decks yet" while an authed device is still pulling', () => {
    renderPage();
    expect(screen.queryByText(/No decks yet/i)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('does not say it in the idle window before startSync sets syncing either', () => {
    syncMock.state = 'idle';
    renderPage();
    expect(screen.queryByText(/No decks yet/i)).toBeNull();
  });

  it('DOES show the empty state once sync settles — a real empty account still gets its door', () => {
    // The guard must not swallow the genuine empty state; that would replace a
    // wrong answer with no answer.
    syncMock.state = 'ready';
    renderPage();
    expect(screen.getByText(/No decks yet/i)).toBeTruthy();
  });

  it('shows the empty state when the pull FAILED, rather than spinning forever', () => {
    syncMock.state = 'syncing';
    syncMock.error = true;
    renderPage();
    expect(screen.getByText(/No decks yet/i)).toBeTruthy();
  });

  it('shows the empty state for a guest, who has no rows coming', () => {
    authMock.status = 'guest';
    syncMock.state = 'syncing';
    renderPage();
    expect(screen.getByText(/No decks yet/i)).toBeTruthy();
  });
});
