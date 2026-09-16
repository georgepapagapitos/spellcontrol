// @vitest-environment happy-dom
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared "first pull still in flight" signal.
 *
 * Playtest batch 5 measured five routes asserting a CONFIDENT empty state
 * during this window on a cold device that owns the data
 * (`.claude/tools/b5-empty-scope.mjs`, phone, dev account):
 *
 *   /decks               1380ms of "0 decks · No decks yet"  (account has 9)
 *   /collection/binders  1106ms of "No binders yet"          (account has 4)
 *   /decks/cube          1052ms of "You haven't imported a collection yet"
 *   /collection/lists    1049ms of "No lists yet"
 *   /home                 998ms of the Get-started checklist
 *
 * The guard existed five times before this hook, hand-rolled and each spelling
 * slightly different. The three differences below were real bugs, not style,
 * so they are asserted individually.
 */

const syncMock = vi.hoisted(() => ({
  state: 'idle' as 'idle' | 'syncing' | 'ready',
  error: false,
  listeners: new Set<() => void>(),
}));
vi.mock('./sync', () => ({
  getSyncState: () => syncMock.state,
  hasSyncError: () => syncMock.error,
  onSyncedChange: (fn: () => void) => {
    syncMock.listeners.add(fn);
    return () => syncMock.listeners.delete(fn);
  },
}));

const authMock = vi.hoisted(() => ({ status: 'authed' as 'authed' | 'guest' }));
vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: authMock.status }),
}));

import { useAwaitingFirstPull } from './use-awaiting-first-pull';

function Probe() {
  const awaiting = useAwaitingFirstPull();
  return <span data-testid="v">{String(awaiting)}</span>;
}
const value = () => screen.getByTestId('v').textContent;
/** Fire the sync listeners the way `sync.ts:emit()` does. */
const emit = () => act(() => syncMock.listeners.forEach((fn) => fn()));

beforeEach(() => {
  syncMock.state = 'idle';
  syncMock.error = false;
  syncMock.listeners.clear();
  authMock.status = 'authed';
});

describe('useAwaitingFirstPull', () => {
  it('is true in the idle window BEFORE startSync has set syncing', () => {
    // The bug this pins: four of the five hand-rolled copies tested
    // `getSyncState() === 'syncing'`, which reads the pre-startSync `idle`
    // window as settled and shows the empty state anyway. Only BinderPage's
    // copy used `!== 'ready'`.
    syncMock.state = 'idle';
    render(<Probe />);
    expect(value()).toBe('true');
  });

  it('is true while syncing', () => {
    syncMock.state = 'syncing';
    render(<Probe />);
    expect(value()).toBe('true');
  });

  it('is false once sync reaches ready', () => {
    syncMock.state = 'ready';
    render(<Probe />);
    expect(value()).toBe('false');
  });

  it('bails to false on a sync error, so a failed pull does not spin forever', () => {
    // Without this, a pull that fails leaves the state off 'ready' permanently
    // and the page shows a loader instead of falling back to its empty state.
    syncMock.state = 'syncing';
    syncMock.error = true;
    render(<Probe />);
    expect(value()).toBe('false');
  });

  it('is false for a guest, who has no server rows coming', () => {
    authMock.status = 'guest';
    syncMock.state = 'syncing';
    render(<Probe />);
    expect(value()).toBe('false');
  });

  it('REPAINTS when sync settles — it subscribes, it does not read during render', () => {
    // Most prior copies called getSyncState() during render with no
    // subscription, so they only updated when something else happened to
    // re-render them. That is the difference between a loader that clears and
    // one that sits there until an unrelated state change nudges it.
    syncMock.state = 'syncing';
    render(<Probe />);
    expect(value()).toBe('true');

    syncMock.state = 'ready';
    emit();
    expect(value()).toBe('false');
  });

  it('repaints when a sync error arrives mid-flight', () => {
    syncMock.state = 'syncing';
    render(<Probe />);
    expect(value()).toBe('true');

    syncMock.error = true;
    emit();
    expect(value()).toBe('false');
  });
});
