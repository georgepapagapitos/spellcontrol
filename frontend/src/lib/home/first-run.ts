/**
 * "Have we ever shown this device past the first-run gate?"
 *
 * On a brand-new install we route the user to the
 * welcome storefront at `/` before dropping them into the main app, so
 * signing in (one of its own doors) is an obvious early choice instead of an
 * afterthought hidden in Settings. The gate is one-shot: as soon as the user
 * makes any intentional first choice — log in, register, finish a Google
 * sign-in, or pick any of the storefront's other doors (samples, browse
 * public decks, import a collection) — we set this flag and never gate them
 * again.
 *
 * Storage is plain localStorage. We don't sync it to the server: it
 * answers "is this device past first-run?", which is intentionally local.
 * Reads tolerate localStorage being unavailable (Safari private mode, SSR)
 * by treating the device as already-visited — better to skip the gate than
 * to trap a user on a storefront they can't get past.
 */
const KEY = 'sc-ever-visited-app';

export function hasEverVisited(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) !== null;
  } catch {
    // Storage unavailable — pretend we've visited so we don't gate the user.
    return true;
  }
}

export function markEverVisited(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
  } catch {
    /* ignore — see hasEverVisited */
  }
}
