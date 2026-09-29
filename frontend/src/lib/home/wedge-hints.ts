/**
 * Device-local, once-ever discovery hints for features that shipped without
 * any proactive signal telling the user they exist (the "wedge" audit):
 * the binder-location badge (PR #1344) only appears once a Collection-tab
 * row actually routes to a binder, deck re-sync (PR #1347) is one item
 * among a dozen in the ⋮ overflow menu, and the playtest drag-to-play hint
 * (E484) only appears once a kept hand is actually on the board. Bare
 * localStorage flag per hint:
 * device-local (never synced, same
 * precedent as every other once-only tip in this codebase — see
 * `build-report-seen.ts`), fail-safe to HIDDEN
 * on a storage error (an unwanted popup is worse than a missed one). No
 * registry — this is three hints, so it's three pairs of functions, not a
 * config system.
 */
import type { DeckSource } from '@/store/decks';

const BINDER_HINT_KEY = 'sc-hint-binder-location-v1';
const RESYNC_HINT_KEY = 'sc-hint-deck-resync-v1';
const PLAYTEST_DRAG_HINT_KEY = 'sc-hint-playtest-drag-v1';

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
/** Resync diffs a list pasted from Moxfield or Archidekt, so it only makes
 *  sense on a deck that could have come from one. A generated deck never did:
 *  the hint on a player's first generated deck pointed at nothing. */
export function shouldShowResyncHint(deckHasCards: boolean, source?: DeckSource): boolean {
  return deckHasCards && source !== 'generated' && !seen(RESYNC_HINT_KEY);
}

export function dismissResyncHint(): void {
  markSeen(RESYNC_HINT_KEY);
}

/**
 * True the first time a kept hand is sitting on the playtest board with the
 * game actually underway. The caller gates out the opening-hand/mulligan
 * takeover itself (there is no battlefield on screen yet to drag onto), so
 * this only takes whether the hand is non-empty.
 */
export function shouldShowPlaytestDragHint(handHasCards: boolean): boolean {
  return handHasCards && !seen(PLAYTEST_DRAG_HINT_KEY);
}

export function dismissPlaytestDragHint(): void {
  markSeen(PLAYTEST_DRAG_HINT_KEY);
}
