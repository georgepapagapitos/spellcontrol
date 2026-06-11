// @vitest-environment happy-dom
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncIndicator, HeaderSyncIndicator, formatRelativeTime } from './SyncIndicator';
import { useAuth } from '../store/auth';
import * as sync from '../lib/sync';

function renderIndicator() {
  return render(<SyncIndicator />);
}

// Capture the listener installed via onSyncedChange so a test can drive
// re-renders deterministically.
let emit: () => void = () => {};

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: null, status: 'guest', error: null, autoLinkedAt: null });
  vi.spyOn(sync, 'onSyncedChange').mockImplementation((fn: () => void) => {
    emit = fn;
    return () => {
      emit = () => {};
    };
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" within the first 45 seconds', () => {
    expect(formatRelativeTime(1_000_000, 1_000_000)).toBe('just now');
    expect(formatRelativeTime(1_000_000, 1_000_000 + 44_000)).toBe('just now');
  });

  it('returns "Nm ago" for the minutes band', () => {
    const base = 1_000_000;
    expect(formatRelativeTime(base, base + 60_000)).toBe('1m ago');
    expect(formatRelativeTime(base, base + 5 * 60_000)).toBe('5m ago');
    expect(formatRelativeTime(base, base + 59 * 60_000)).toBe('59m ago');
  });

  it('returns "Nh ago" for the hours band', () => {
    const base = 1_000_000;
    expect(formatRelativeTime(base, base + 60 * 60_000)).toBe('1h ago');
    expect(formatRelativeTime(base, base + 12 * 60 * 60_000)).toBe('12h ago');
    expect(formatRelativeTime(base, base + 23 * 60 * 60_000)).toBe('23h ago');
  });

  it('returns "Nd ago" for >= 24h', () => {
    const base = 1_000_000;
    expect(formatRelativeTime(base, base + 24 * 60 * 60_000)).toBe('1d ago');
    expect(formatRelativeTime(base, base + 3 * 24 * 60 * 60_000)).toBe('3d ago');
  });

  it('clamps future timestamps to "just now"', () => {
    expect(formatRelativeTime(1_000_000 + 5_000, 1_000_000)).toBe('just now');
  });
});

describe('SyncIndicator', () => {
  it('renders "Local only" status for guests (sign-in lives in Settings)', () => {
    useAuth.setState({ status: 'guest' });
    renderIndicator();
    expect(screen.getByText('Local only')).toBeTruthy();
    // No action affordance — purely informational status.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the syncing state with a spinner glyph when authed + syncing', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    const { container } = renderIndicator();
    expect(screen.getByText(/Syncing/)).toBeTruthy();
    expect(container.querySelector('.sync-indicator-spinner')).toBeTruthy();
  });

  it('renders "Synced" with a relative-time tooltip when ready + has timestamp', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    vi.spyOn(sync, 'getSyncState').mockReturnValue('ready');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(Date.now() - 5 * 60_000);
    renderIndicator();
    expect(screen.getByText('Synced')).toBeTruthy();
    const el = screen.getByLabelText(/Last synced 5m ago/);
    expect(el.getAttribute('title')).toBe('Last synced 5m ago');
  });

  it('renders nothing when authed + ready but no last-synced timestamp yet', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    vi.spyOn(sync, 'getSyncState').mockReturnValue('ready');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    const { container } = renderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when authed + idle (pre-first-sync, avoids flash)', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    vi.spyOn(sync, 'getSyncState').mockReturnValue('idle');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    const { container } = renderIndicator();
    expect(container.firstChild).toBeNull();
  });

  function authed() {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    // Sensible defaults; individual tests override as needed.
    vi.spyOn(sync, 'getSyncState').mockReturnValue('ready');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(Date.now());
    vi.spyOn(sync, 'isOnline').mockReturnValue(true);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(0);
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(false);
  }

  it('renders an Offline pill when disconnected, mentioning local safety', () => {
    authed();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(3);
    renderIndicator();
    const el = screen.getByText('Offline');
    expect(el).toBeTruthy();
    expect(el.getAttribute('title')).toMatch(/3 changes saved on this device/);
  });

  it('Offline outranks a sync error and an active syncing state', () => {
    authed();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    renderIndicator();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Sync failed')).toBeNull();
    expect(screen.queryByText(/Syncing/)).toBeNull();
  });

  it('renders a "Sync failed" pill when online and the last sync errored', () => {
    authed();
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    renderIndicator();
    const el = screen.getByText('Sync failed');
    expect(el).toBeTruthy();
    expect(el.getAttribute('title')).toMatch(/retrying/i);
  });

  it('a sync error outranks pending "Saving"', () => {
    authed();
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(2);
    renderIndicator();
    expect(screen.getByText('Sync failed')).toBeTruthy();
    expect(screen.queryByText(/Saving/)).toBeNull();
  });

  it('renders a "Saving…" pill with a spinner when there are pending changes', () => {
    authed();
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(2);
    const { container } = renderIndicator();
    const el = screen.getByText(/Saving/);
    expect(el).toBeTruthy();
    expect(screen.getByLabelText('Saving 2 changes…')).toBeTruthy();
    expect(container.querySelector('.sync-indicator-spinner')).toBeTruthy();
  });

  it('falls through to "Synced" when online, idle queue, no error', () => {
    authed();
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(Date.now() - 5 * 60_000);
    renderIndicator();
    expect(screen.getByText('Synced')).toBeTruthy();
  });

  it('re-renders when the sync listener fires (e.g. syncing → ready)', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    const stateSpy = vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    const tsSpy = vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    renderIndicator();
    expect(screen.getByText(/Syncing/)).toBeTruthy();
    stateSpy.mockReturnValue('ready');
    tsSpy.mockReturnValue(Date.now());
    act(() => {
      emit();
    });
    expect(screen.getByText('Synced')).toBeTruthy();
  });
});

// ── HeaderSyncIndicator ──────────────────────────────────────────────────────

function renderHeaderIndicator() {
  return render(
    <MemoryRouter>
      <HeaderSyncIndicator />
    </MemoryRouter>
  );
}

/** Set auth to authed and configure sensible sync defaults. Individual tests
 *  override specific spies to drive the state they want. */
function authedHeader() {
  useAuth.setState({
    user: { id: 'u', username: 'a', role: 'user' },
    status: 'authed',
    autoLinkedAt: null,
  });
  vi.spyOn(sync, 'getSyncState').mockReturnValue('ready');
  vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(Date.now());
  vi.spyOn(sync, 'isOnline').mockReturnValue(true);
  vi.spyOn(sync, 'getPendingCount').mockReturnValue(0);
  vi.spyOn(sync, 'hasSyncError').mockReturnValue(false);
}

describe('HeaderSyncIndicator', () => {
  it('renders nothing when guest (no cloud sync to report)', () => {
    useAuth.setState({ status: 'guest' });
    const { container } = renderHeaderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when auth status is unknown/loading', () => {
    useAuth.setState({ status: 'unknown' });
    const { container } = renderHeaderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when authed and fully synced (silence = synced)', () => {
    authedHeader();
    const { container } = renderHeaderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when authed + idle (pre-first-sync, avoids flash)', () => {
    authedHeader();
    vi.spyOn(sync, 'getSyncState').mockReturnValue('idle');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    const { container } = renderHeaderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders Offline pill when disconnected', () => {
    authedHeader();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(0);
    renderHeaderIndicator();
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('renders Offline pill with pending count when disconnected with queued changes', () => {
    authedHeader();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(3);
    renderHeaderIndicator();
    expect(screen.getByText(/Offline — 3 changes saved locally/)).toBeTruthy();
  });

  it('renders Syncing pill with spinner when actively syncing', () => {
    authedHeader();
    vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    const { container } = renderHeaderIndicator();
    expect(screen.getByText(/Syncing/)).toBeTruthy();
    expect(container.querySelector('.sync-indicator-spinner')).toBeTruthy();
  });

  it('renders Sync failed pill when errored', () => {
    authedHeader();
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    renderHeaderIndicator();
    expect(screen.getByText('Sync failed')).toBeTruthy();
  });

  it('renders Saving pill with spinner when there are pending changes', () => {
    authedHeader();
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(2);
    const { container } = renderHeaderIndicator();
    expect(screen.getByText(/Saving/)).toBeTruthy();
    expect(container.querySelector('.sync-indicator-spinner')).toBeTruthy();
  });

  it('Offline outranks Sync failed and Syncing', () => {
    authedHeader();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    renderHeaderIndicator();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Sync failed')).toBeNull();
    expect(screen.queryByText(/Syncing/)).toBeNull();
  });

  it('Sync failed outranks Saving', () => {
    authedHeader();
    vi.spyOn(sync, 'hasSyncError').mockReturnValue(true);
    vi.spyOn(sync, 'getPendingCount').mockReturnValue(5);
    renderHeaderIndicator();
    expect(screen.getByText('Sync failed')).toBeTruthy();
    expect(screen.queryByText(/Saving/)).toBeNull();
  });

  it('tapping the indicator links to /settings', () => {
    authedHeader();
    vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    renderHeaderIndicator();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('re-renders when the sync listener fires (offline → online + synced)', () => {
    authedHeader();
    const onlineSpy = vi.spyOn(sync, 'isOnline').mockReturnValue(false);
    renderHeaderIndicator();
    expect(screen.getByText('Offline')).toBeTruthy();
    onlineSpy.mockReturnValue(true);
    act(() => {
      emit();
    });
    expect(screen.queryByText('Offline')).toBeNull();
  });
});
