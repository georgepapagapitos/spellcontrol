/**
 * Back-button integration for the shared overlay stack (overlay-layer.ts,
 * E481/T157). "Back closes the topmost overlay first" — only when nothing is
 * registered on the stack does Back navigate the page, and it costs exactly
 * ONE press per overlay to close and no MORE than one extra press to then
 * actually leave — never two presses that both look like nothing happened.
 *
 * Mechanism: while at least one overlay that opted in is open, the CURRENT
 * history entry carries a flag in its `state` (same URL — pushed with
 * `history.pushState(..., '', window.location.href)` — so the address bar
 * never changes and react-router never sees a route it needs to render). A
 * physical Back press fires `popstate`; if an overlay is open at that moment,
 * this closes the topmost layer through the SAME path Escape uses (the
 * caller's own `dismiss`, e.g. a sheet's `beginClose`) and only RE-marks the
 * entry it landed on if something will still be open afterward — either the
 * close was refused (`dismissTopmost` returns false — a `dismissable={false}`
 * Modal mid-save) or more than one overlay was registered (nested). If this
 * was the sole overlay and it accepted the close, nothing is re-marked: the
 * entry underneath is a real, unmarked page, and the very next Back press
 * genuinely leaves.
 *
 * Consumption is deliberately LAZY: a close by any other means (✕, backdrop,
 * Escape, an action) never touches `window.history` at all — an eager
 * `history.back()` there raced a same-tick or later-microtask/timeout
 * `navigate()` the same action might also trigger (a menu item, a
 * delete-then-redirect), and the queued traversal could land after the new
 * `pushState` and silently undo it. So the marked entry is simply left as the
 * current one. Two different situations can follow, and both are made
 * transparent (no extra press, nothing stranding the user on a duplicate of
 * the same screen):
 *
 *  1. The user later backs INTO that marked entry from somewhere else
 *     (having navigated away without ever pressing Back — e.g. a context
 *     pill that closes and routes elsewhere, or a marker that outlived a
 *     full page reload). `onPopState` recognizes the entry it just LANDED on
 *     is flagged and skips it forward with one more `history.back()`.
 *  2. The user instead backs OFF that marked entry, landing on the very page
 *     it was cloned from — which, since it shares that page's href AND
 *     react-router `idx` (spread verbatim when marking), is otherwise
 *     indistinguishable from "nothing happened." `staleMarkerIdx` remembers
 *     the idx of any marker left behind lazily (case 1's marker doesn't
 *     count — that's cleared the moment it's skipped or consumed); a
 *     popstate landing on an UNMARKED entry whose idx matches it has just
 *     departed that leftover marker onto its own origin page, so THIS press
 *     also cascades one more `history.back()`. Cleared whenever it's
 *     consumed by a paired Back press, skipped, or superseded by a fresh
 *     mark, so it can never misfire on an unrelated later revisit to that
 *     idx (Forward, then Back again).
 *
 * This module owns the history mechanics only. It knows nothing about
 * `layerStack` — `overlay-layer.ts` is the only caller, and hands in two
 * closures (`participantCount`, `dismissTopmost`) that read its own state.
 * That keeps this a one-way dependency (no import cycle) and makes the
 * mechanics unit-testable on their own, with fake hooks.
 */

const MARKER_KEY = '__scOverlayBack';

export interface OverlayHistoryHooks {
  /** How many overlays that opted into this integration are registered right
   *  now (0 when none are open). */
  participantCount: () => number;
  /** Close the current topmost overlay via its own dismiss path (same one
   *  Escape uses) — a sheet's `beginClose`, a Modal's `beginClose`, etc.
   *  Returns whether the close was ACCEPTED: false for a Modal with
   *  `dismissable={false}` mid-save, which stays open. */
  dismissTopmost: () => boolean;
}

export interface OverlayHistoryController {
  /** Call once a participating overlay has been pushed onto the stack.
   *  Idempotent: a no-op if the current entry is already flagged. */
  registered(): void;
  /** Removes the popstate listener. Tests use this for isolation; the app's
   *  own singleton controller lives for the tab's lifetime and never calls it. */
  destroy(): void;
}

function getIdx(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const idx = (window.history.state as Record<string, unknown> | null)?.idx;
  return typeof idx === 'number' ? idx : undefined;
}

function isCurrentEntryMarked(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.history.state as Record<string, unknown> | null)?.[MARKER_KEY];
}

/**
 * Marks the current entry unless it's already marked. Spreads the existing
 * state (react-router keeps its own `idx`/`key`/`usr` there) rather than
 * replacing it, so its own back/forward bookkeeping sees an entry it
 * recognizes when this fires a popstate it didn't initiate — same URL, so no
 * route match changes. Returns the idx the (now-)marked entry carries, the
 * same one its origin page has, since marking never changes it.
 */
function markCurrentEntry(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!isCurrentEntryMarked()) {
    window.history.pushState(
      { ...(window.history.state ?? {}), [MARKER_KEY]: true },
      '',
      window.location.href
    );
  }
  return getIdx();
}

export function createOverlayHistoryController(
  hooks: OverlayHistoryHooks
): OverlayHistoryController {
  let ignoreNextPopstate = false;
  // See the module doc's case 2. `undefined` means "no leftover marker to
  // watch for."
  let staleMarkerIdx: number | undefined = isCurrentEntryMarked() ? getIdx() : undefined;

  function onPopState(e: PopStateEvent) {
    if (ignoreNextPopstate) {
      ignoreNextPopstate = false;
      return;
    }

    const countBefore = hooks.participantCount();
    if (countBefore > 0) {
      const accepted = hooks.dismissTopmost();
      if (!accepted || countBefore > 1) {
        // Something will still be open right after this: re-mark so the
        // NEXT Back is intercepted too.
        staleMarkerIdx = markCurrentEntry();
      } else {
        // The sole overlay accepted the close, paired 1:1 with this very
        // Back press. The entry underneath is real and unmarked — nothing
        // left behind to remember, and the next Back genuinely leaves.
        staleMarkerIdx = undefined;
      }
      return;
    }

    // Nothing open. Landed directly on one of our own marker entries — a
    // stale one reached from somewhere else (a close-that-also-navigated, or
    // one that outlived a full page reload) — skip it forward.
    const state = e.state as Record<string, unknown> | null;
    if (state?.[MARKER_KEY]) {
      staleMarkerIdx = undefined;
      ignoreNextPopstate = true;
      window.history.back();
      return;
    }

    // Landed on an UNMARKED entry that shares idx with a marker left behind
    // lazily — departed our own leftover marker onto its own origin page,
    // which read as "nothing happened." Cascade once more.
    const landedIdx = state?.idx;
    if (staleMarkerIdx !== undefined && landedIdx === staleMarkerIdx) {
      staleMarkerIdx = undefined;
      ignoreNextPopstate = true;
      window.history.back();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', onPopState);
  }

  return {
    registered() {
      staleMarkerIdx = markCurrentEntry();
    },
    destroy() {
      if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
    },
  };
}
