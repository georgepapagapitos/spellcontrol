/**
 * Lightweight haptic feedback wrappers around navigator.vibrate.
 *
 * iOS Safari doesn't implement the Vibration API, so every call is feature-
 * detected and silently no-ops on unsupported platforms. A module-level
 * `enabled` flag lets us wire to a user setting later without touching call
 * sites.
 */

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined') return;
  const fn = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (typeof fn !== 'function') return;
  try {
    // Cast is safe: at runtime navigator.vibrate accepts number | number[].
    // TS lib.dom narrows the param to Iterable<number> in some versions.
    (fn as (p: number | number[]) => boolean).call(navigator, pattern);
  } catch {
    // Some browsers throw if called from a non-user-gesture context; ignore.
  }
}

export const haptics = {
  tap: () => vibrate(10),
  lethal: () => vibrate([20, 40, 60]),
  eliminate: () => vibrate([30, 30, 30]),
};
