// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A binder deep link must survive a device that has never cached the account.
 *
 * The defect (playtest batch 4, 2026-09-15): a full page load at
 * /collection/binders/<real id> landed on /collection/binders instead — in
 * under 0.7s, so a redirect, not a slow render. Proven by A/B with
 * .claude/tools/binder-deeplink.mjs: a cold browser context bounced, the same
 * id clicked in-app opened fine, and after warming the cache once the same
 * direct load worked.
 *
 * Cause: `hydrating` only covers reading IndexedDB. On a fresh browser there
 * is nothing in it, so the flag flips false with an EMPTY store while the
 * account's rows are still arriving from the first pull — and the
 * "no binders / no cards → the index owns those empty states" redirect fired
 * in that window. Real users hit it via a bookmark, a shared link, a new
 * browser, or a reload after clearing site data.
 *
 * No unit test could see it before this one, because every existing test
 * starts with the store already populated. These drive the empty-store window
 * directly.
 */

const syncMock = vi.hoisted(() => ({
  state: 'syncing' as 'idle' | 'syncing' | 'ready',
  error: false,
}));
vi.mock('../lib/sync', () => ({
  getSyncState: () => syncMock.state,
  hasSyncError: () => syncMock.error,
  onSyncedChange: () => () => {},
}));

// Keep the page light: this is about the redirect decision, not rendering.
vi.mock('../lib/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('../lib/materialize', () => ({ materializeBinders: () => ({ binders: [] }) }));

import { BinderPage } from './BinderPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';

const BINDER_ID = 'binder-abc';

function renderDeepLink() {
  return render(
    <MemoryRouter initialEntries={[`/collection/binders/${BINDER_ID}`]}>
      <Routes>
        <Route path="/collection/binders" element={<div>BINDER INDEX</div>} />
        <Route path="/collection/binders/:id" element={<BinderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  syncMock.state = 'syncing';
  syncMock.error = false;
  // The state a cold device is in: local cache read (hydrating false) and
  // completely empty, with the account's rows still in flight.
  useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
  useAuth.setState({ status: 'authed' });
});

describe('binder deep link on a device with no cached collection', () => {
  it('waits instead of bouncing to the index while the first pull is in flight', () => {
    renderDeepLink();
    expect(
      screen.queryByText('BINDER INDEX'),
      'a signed-in device whose rows have not arrived yet was sent to the index — ' +
        'the binder deep link is lost for anyone opening it on a new browser or device'
    ).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('still bounces once sync has settled and the account really is empty', () => {
    // The redirect's original purpose, which must survive the fix: a genuinely
    // empty account belongs on the index, where the import call-to-action is.
    syncMock.state = 'ready';
    renderDeepLink();
    expect(screen.getByText('BINDER INDEX')).toBeTruthy();
  });

  it('bounces rather than spinning forever when the pull failed', () => {
    // A failed pull leaves the state at 'syncing'; without this bail the page
    // would wait on a pull that is never coming.
    syncMock.error = true;
    renderDeepLink();
    expect(screen.getByText('BINDER INDEX')).toBeTruthy();
  });

  it('does not make a guest wait on a sync that will never run', () => {
    useAuth.setState({ status: 'guest' });
    syncMock.state = 'idle';
    renderDeepLink();
    expect(screen.getByText('BINDER INDEX')).toBeTruthy();
  });
});
