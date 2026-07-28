/**
 * Device-local, once-ever discovery hints for features that shipped without
 * any proactive signal telling the user they exist (the "wedge" audit):
 * the binder-location badge (PR #1344) only appears once a Collection-tab
 * row actually routes to a binder, and deck re-sync (PR #1347) is one item
 * among a dozen in the ⋮ overflow menu. Mirrors `nav-migration-tip.ts`'s
 * bare-localStorage-flag pattern exactly: device-local (never synced, same
 * precedent as every other once-only tip in this codebase — see
 * `build-report-seen.ts`/`between-decks-dismissed.ts`), fail-safe to HIDDEN
 * on a storage error (an unwanted popup is worse than a missed one). No
 * registry — this is two hints, so it's two pairs of functions, not a
 * config system.
 */

const BINDER_HINT_KEY = 'sc-hint-binder-location-v1';
const RESYNC_HINT_KEY = 'sc-hint-deck-resync-v1';

function seen(key: string): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

function markSeen(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1');
  } catch {
    /* ignore — see `seen()`'s fail-safe-hidden default above */
  }
}

/**
 * True the first time a Collection-tab search actually has a binder match on
 * screen — i.e. the badge this hint points at is genuinely visible, not a
 * promise about a feature the user can't yet see (no binders, or binders with
 * no owned-card matches yet, both stay silent).
 */
export function shouldShowBinderHint(hasBinderMatch: boolean): boolean {
  return hasBinderMatch && !seen(BINDER_HINT_KEY);
}

export function dismissBinderHint(): void {
  markSeen(BINDER_HINT_KEY);
}

/**
 * True for an existing deck with a real mainboard — a brand-new empty deck
 * has nothing to diff a pasted list against yet.
 */
export function shouldShowResyncHint(deckHasCards: boolean): boolean {
  return deckHasCards && !seen(RESYNC_HINT_KEY);
}

export function dismissResyncHint(): void {
  markSeen(RESYNC_HINT_KEY);
}
