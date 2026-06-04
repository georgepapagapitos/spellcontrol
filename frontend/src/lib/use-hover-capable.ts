import { useSyncExternalStore } from 'react';

/**
 * The one capability gate for the desktop card-preview surfaces (the deck
 * hover-peek and the collection `CardSlot` tooltip). A fine pointer with true
 * hover — a real mouse / trackpad / stylus, never a finger.
 *
 * `(hover: hover)` alone is unreliable: Chrome/Android (notably Samsung) reports
 * it `true` on touch because the device *could* gain a mouse, so a finger would
 * wrongly raise hover UI. The `(pointer: fine)` half is the load-bearing part —
 * it's what keeps touch / native off the hover path. Both surfaces read this one
 * query so they can never disagree on who counts as "hover-capable".
 */
export const HOVER_CAPABLE_QUERY = '(hover: hover) and (pointer: fine)';

// One process-wide MediaQueryList, lazily created. Every subscriber attaches its
// own change listener to this shared object (cheap) rather than spinning up a
// fresh MQL per component — a card grid can mount hundreds of CardSlots.
let sharedMql: MediaQueryList | null = null;
function mql(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (!sharedMql) sharedMql = window.matchMedia(HOVER_CAPABLE_QUERY);
  return sharedMql;
}

function subscribe(onChange: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return mql()?.matches ?? false;
}

// SSR / no-DOM: assume not hover-capable, so nothing hover-only renders on the
// server and hydration matches a touch-first default.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Reactive `true` only on a fine-hover pointer (see {@link HOVER_CAPABLE_QUERY}).
 * Re-renders the consumer when capability flips — a mouse plugged into a tablet,
 * a convertible folded into laptop mode — so a surface gated on it appears or
 * disappears live instead of being frozen to its first-render value.
 */
export function useHoverCapable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Test-only: drop the cached MQL so a suite can swap window.matchMedia between
// cases. Not part of the runtime contract. Call it only with all useHoverCapable
// consumers unmounted (e.g. in afterEach, after RTL auto-cleanup) — resetting
// mid-mount would orphan a live listener on the discarded MQL.
export function __resetHoverCapableForTests(): void {
  sharedMql = null;
}
