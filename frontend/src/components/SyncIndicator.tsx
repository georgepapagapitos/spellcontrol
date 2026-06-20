import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getSyncState,
  getPendingCount,
  isOnline,
  hasSyncError,
  getLastSyncedAt,
  onSyncedChange,
} from '../lib/sync';
import { formatRelativeTime } from '../lib/format-time';
import { useAuth } from '../store/auth';

// Sync-badge options: 45s "just now" threshold (label stabilizes quickly —
// the header isn't a second-by-second timer) + no months/years tier
// ("3mo ago" would alarm a sync-badge reader; "Nd ago" is the right ceiling).
const SYNC_FORMAT_OPTS = { justNowThresholdSec: 45, includeMonthsYears: false } as const;

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
    const rel = formatRelativeTime(lastSyncedAt, SYNC_FORMAT_OPTS);
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

/**
 * Compact header badge — surfaces sync anxiety signals (offline / error /
 * pending) in the site header so users see them wherever they are, not just
 * on the Settings page.
 *
 * Silence = synced: when everything is fine, render NOTHING. No green
 * checkmark noise. The full indicator (with "Synced Nm ago") remains in the
 * Settings Account card.
 *
 * Signed-out / guest / unknown: also renders nothing — there is no cloud sync
 * to report. Guests already know they're local-only from the Settings badge.
 *
 * Tapping leads to /settings (the full sync story + any retry actions live
 * there). The link wraps only the compact pill so it's a contained click
 * target — not the whole nav slot.
 *
 * Non-happy state precedence (same as full SyncIndicator):
 *   Offline → Syncing → Sync failed → Saving (pending)
 * When none of these apply: returns null (happy path, no chrome).
 */
export function HeaderSyncIndicator() {
  const authStatus = useAuth((s) => s.status);
  const [, force] = useState(0);

  useEffect(() => onSyncedChange(() => force((n) => n + 1)), []);

  // Tick once a minute so pending counts / labels stay fresh even without a
  // sync event.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Only render for authenticated users — guests have no cloud sync to report,
  // and unknown/loading flash is worse than silence.
  if (authStatus !== 'authed') return null;

  const online = isOnline();
  const errored = hasSyncError();
  const pending = getPendingCount();
  const state = getSyncState();

  // Offline — most urgent signal.
  if (!online) {
    const label =
      pending > 0
        ? `Offline — ${pending} change${pending === 1 ? '' : 's'} saved locally`
        : 'Offline';
    return (
      <Link
        to="/settings"
        className="sync-indicator sync-indicator-offline header-sync-indicator"
        title="Offline — changes saved on this device. Tap to open Settings."
        aria-label={label}
      >
        {label}
      </Link>
    );
  }

  // Active sync in progress.
  if (state === 'syncing') {
    return (
      <Link
        to="/settings"
        className="sync-indicator sync-indicator-syncing header-sync-indicator"
        aria-label="Syncing…"
      >
        <span className="sync-indicator-spinner" aria-hidden="true" />
        Syncing&hellip;
      </Link>
    );
  }

  // Sync errored.
  if (errored) {
    return (
      <Link
        to="/settings"
        className="sync-indicator sync-indicator-error header-sync-indicator"
        title="Couldn't reach the server — retrying. Tap to open Settings."
        aria-label="Sync failed — tap to open Settings"
      >
        Sync failed
      </Link>
    );
  }

  // Pending local changes queued to push.
  if (pending > 0) {
    const detail = pending === 1 ? 'Saving changes…' : `Saving ${pending} changes…`;
    return (
      <Link
        to="/settings"
        className="sync-indicator sync-indicator-pending header-sync-indicator"
        title={detail}
        aria-label={detail}
      >
        <span className="sync-indicator-spinner" aria-hidden="true" />
        Saving&hellip;
      </Link>
    );
  }

  // Happy path (ready + synced, or idle pre-first-sync) — render nothing.
  // Silence = synced.
  return null;
}
