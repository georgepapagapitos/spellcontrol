// @vitest-environment happy-dom
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncIndicator, formatRelativeTime } from './SyncIndicator';
import { useAuth } from '../store/auth';
import * as sync from '../lib/sync';

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
  it('renders "Local only" for guests', () => {
    useAuth.setState({ status: 'guest' });
    render(<SyncIndicator />);
    expect(screen.getByText('Local only')).toBeTruthy();
  });

  it('renders the syncing state with a spinner glyph when authed + syncing', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    const { container } = render(<SyncIndicator />);
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
    render(<SyncIndicator />);
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
    const { container } = render(<SyncIndicator />);
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
    const { container } = render(<SyncIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('re-renders when the sync listener fires (e.g. syncing → ready)', () => {
    useAuth.setState({
      user: { id: 'u', username: 'a', role: 'user' },
      status: 'authed',
      autoLinkedAt: null,
    });
    const stateSpy = vi.spyOn(sync, 'getSyncState').mockReturnValue('syncing');
    const tsSpy = vi.spyOn(sync, 'getLastSyncedAt').mockReturnValue(null);
    render(<SyncIndicator />);
    expect(screen.getByText(/Syncing/)).toBeTruthy();
    stateSpy.mockReturnValue('ready');
    tsSpy.mockReturnValue(Date.now());
    act(() => {
      emit();
    });
    expect(screen.getByText('Synced')).toBeTruthy();
  });
});
