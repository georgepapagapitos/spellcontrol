export interface FormatRelativeOptions {
  /** Override "now" for deterministic testing. Defaults to Date.now(). */
  now?: number;
  /**
   * Seconds below which "just now" is returned.
   * Default: 60 (matches existing callers on this lib).
   * SyncIndicator passes 45 to keep the header label stable.
   */
  justNowThresholdSec?: number;
  /**
   * Whether to include months/years tiers.
   * Default: true (existing behavior for BinderDriftBanner/DecksIndex/etc).
   * SyncIndicator passes false — "3mo ago" would alarm a sync-badge reader.
   */
  includeMonthsYears?: boolean;
  /**
   * Verbose mode: uses full English words ("3 minutes ago", "2 hours ago")
   * instead of short tokens ("3m ago", "2h ago"), and shows a locale short
   * date (e.g. "Jun 4") for timestamps older than 7 days.
   * Default: false (short tokens). Used by UploadPanel and OfflineModeSettings.
   */
  verbose?: boolean;
  /**
   * Label to return when the timestamp is falsy (0 / null / undefined).
   * Only meaningful when `verbose` is true. Default: undefined (no special case).
   * OfflineModeSettings passes "never" for a cache that has never synced.
   */
  neverLabel?: string;
}

/** Format a timestamp as a relative time string (e.g., "just now", "3m ago"). */
export function formatRelativeTime(timestamp: number, options?: FormatRelativeOptions): string {
  const now = options?.now ?? Date.now();
  const justNowSec = options?.justNowThresholdSec ?? 60;
  const includeMonthsYears = options?.includeMonthsYears ?? true;
  const verbose = options?.verbose ?? false;

  if (verbose && options?.neverLabel && !timestamp) return options.neverLabel;

  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < justNowSec) return 'just now';
  const min = Math.floor(sec / 60);

  if (verbose) {
    if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return day === 1 ? '1 day ago' : `${day} days ago`;
    // 7+ days: locale short date is more readable than "14 days ago"
    try {
      return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return `${day} days ago`;
    }
  }

  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (!includeMonthsYears || day < 30) return `${day}d ago`;
  const months = Math.floor(day / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
