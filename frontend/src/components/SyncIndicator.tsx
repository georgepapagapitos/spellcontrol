import { useEffect, useState } from 'react';
import {
  getSyncState,
  getLastSyncedAt,
  getPendingCount,
  isOnline,
  hasSyncError,
  onSyncedChange,
} from '../lib/sync';
import { useAuth } from '../store/auth';

/**
 * Render-time pure helper — given a "synced at" timestamp and an
 * "as-of" now, returns the compact relative-time label shown in the
 * indicator tooltip. Exported for testing.
 *
 * Bands (chosen so the label stabilizes quickly — the header isn't a
 * second-by-second timer):
 *   < 45s  → "just now"
 *   < 60m  → "Nm ago"
 *   < 24h  → "Nh ago"
 *   else   → "Nd ago"
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper tested in this file; HMR cost only matters on dev edits, not worth a separate module
export function formatRelativeTime(syncedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - syncedAt);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Compact sync-state badge for the header. Subscribes to sync.ts so the
 * label updates as state changes (pushes/pulls land, the queue grows/drains,
 * connectivity flips, a sync fails).
 *
 * Precedence (most → least urgent), so the user always sees the truest signal:
 *   Offline → Syncing → Sync failed → Saving (pending) → Synced.
 * Offline outranks "failed" because being offline is the real reason a sync
 * can't happen; "Saving" reassures that local changes aren't lost yet.
 */
export function SyncIndicator() {
  const authStatus = useAuth((s) => s.status);
  const [, force] = useState(0);

  useEffect(() => onSyncedChange(() => force((n) => n + 1)), []);

  // Tick once a minute so the "Nm ago" label rolls forward without
  // requiring a sync event. Cheap; bails when nothing to show.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (authStatus === 'guest') {
    // Pure status pill for guests — informational, not an action. Sign-in
    // lives in Settings on every breakpoint; the indicator stays out of
    // CTA territory so the header has exactly one "status" slot and zero
    // duplicated affordances.
    return (
      <span className="sync-indicator sync-indicator-local" aria-live="polite">
        Local only
      </span>
    );
  }

  // Non-authed-non-guest states ('unknown' / 'loading') render nothing —
  // the auth bootstrap is fast and a flash of indicator is worse than none.
  if (authStatus !== 'authed') return null;

  const state = getSyncState();
  const lastSyncedAt = getLastSyncedAt();
  const pending = getPendingCount();
  const online = isOnline();
  const errored = hasSyncError();

  if (!online) {
    const detail =
      pending > 0
        ? `Offline — ${pending} change${pending === 1 ? '' : 's'} saved on this device, will sync when you reconnect`
        : 'Offline — changes are saved on this device';
    return (
      <span
        className="sync-indicator sync-indicator-offline"
        title={detail}
        aria-label={detail}
        aria-live="polite"
      >
        Offline
      </span>
    );
  }

  if (state === 'syncing') {
    return (
      <span className="sync-indicator sync-indicator-syncing" aria-live="polite">
        <span className="sync-indicator-spinner" aria-hidden="true" />
        Syncing&hellip;
      </span>
    );
  }

  if (errored) {
    return (
      <span
        className="sync-indicator sync-indicator-error"
        title="Couldn't reach the server — retrying. Your changes are saved on this device."
        aria-label="Sync failed, retrying"
        aria-live="polite"
      >
        Sync failed
      </span>
    );
  }

  if (pending > 0) {
    const detail = pending === 1 ? 'Saving changes…' : `Saving ${pending} changes…`;
    return (
      <span
        className="sync-indicator sync-indicator-pending"
        title={detail}
        aria-label={detail}
        aria-live="polite"
      >
        <span className="sync-indicator-spinner" aria-hidden="true" />
        Saving&hellip;
      </span>
    );
  }

  if (state === 'ready' && lastSyncedAt != null) {
    const rel = formatRelativeTime(lastSyncedAt);
    return (
      <span
        className="sync-indicator sync-indicator-ready"
        title={`Last synced ${rel}`}
        aria-label={`Last synced ${rel}`}
      >
        <span className="sync-indicator-check" aria-hidden="true">
          &#10003;
        </span>
        Synced
      </span>
    );
  }

  // idle + authed, or ready but no timestamp yet — render nothing to avoid a
  // pre-first-sync flash.
  return null;
}
