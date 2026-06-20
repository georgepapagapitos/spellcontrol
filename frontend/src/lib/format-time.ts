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
}

/** Format a timestamp as a relative time string (e.g., "just now", "3m ago"). */
export function formatRelativeTime(timestamp: number, options?: FormatRelativeOptions): string {
  const now = options?.now ?? Date.now();
  const justNowSec = options?.justNowThresholdSec ?? 60;
  const includeMonthsYears = options?.includeMonthsYears ?? true;
  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < justNowSec) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (!includeMonthsYears || day < 30) return `${day}d ago`;
  const months = Math.floor(day / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
