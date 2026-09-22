/**
 * Tiny haptic feedback helpers on `navigator.vibrate`, with approximate
 * patterns per cue. iOS Safari doesn't implement Vibration, so this silently
 * no-ops there.
 *
 * Calls are fire-and-forget. A failed cue must never change app behavior;
 * haptics are decoration.
 *
 * The module-level `enabled` flag is wired to a persisted user setting
 * via `setHapticsEnabled`; `usePlayStore` mirrors it on hydrate.
 */

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return;
  const fn = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (typeof fn !== 'function') return;
  try {
    // Runtime accepts number | number[]; lib.dom narrows to Iterable<number> in
    // newer versions. The cast keeps both shapes working.
    (fn as (p: number | number[]) => boolean).call(navigator, pattern);
  } catch {
    // Some browsers throw outside a user-gesture; non-fatal.
  }
}

export const haptics = {
  /** Light tap — for routine actions (draw, undo/redo, untap, tap-permanent). */
  tap(): void {
    if (!enabled) return;
    vibrate(10);
  },

  /**
   * Success cue — a completed action landed. Note the scanner does NOT call
   * this for every scan: camera accepts route through `scanner-feedback.ts`'s
   * value-tier mapping (commons get `tap`, mid-tier cards land here, jackpots
   * get `lethal`); manual queue adds fire it directly.
   */
  success(): void {
    if (!enabled) return;
    vibrate(40);
  },

  /** Warning cue — for destructive/coarse actions (mulligan, reset, danger-confirm press). */
  warning(): void {
    if (!enabled) return;
    vibrate([20, 30, 20]);
  },

  /** Game-ending hit — a player went to lethal. */
  lethal(): void {
    if (!enabled) return;
    vibrate([20, 40, 60]);
  },

  /** Player eliminated — a sharper, repeating cue. */
  eliminate(): void {
    if (!enabled) return;
    vibrate([30, 30, 30]);
  },

  /** Step-up bump — fired when the hold-ramp advances to a larger step size. */
  bump(): void {
    if (!enabled) return;
    vibrate(25);
  },
};
