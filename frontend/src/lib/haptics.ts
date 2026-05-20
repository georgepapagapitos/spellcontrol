import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativePlatform } from './platform';

/**
 * Tiny haptic feedback helpers, branched by platform.
 *
 * - **Native (iOS/Android):** `@capacitor/haptics`. iOS exposes a real
 *   semantic vocabulary (impact light/medium/heavy, notification
 *   success/warning/error); Android maps to the OS haptic engine — coarser
 *   but real.
 * - **Web:** `navigator.vibrate` with approximate patterns. iOS Safari
 *   doesn't implement Vibration, so this silently no-ops there.
 *
 * Calls are fire-and-forget. A failed cue must never change app behavior;
 * haptics are decoration.
 *
 * The module-level `enabled` flag is wired to a persisted user setting
 * via `setHapticsEnabled`; `useGameStore` mirrors it on hydrate.
 */

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function nativeImpact(style: ImpactStyle): void {
  void Haptics.impact({ style }).catch(() => {});
}

function nativeNotify(type: NotificationType): void {
  void Haptics.notification({ type }).catch(() => {});
}

function webVibrate(pattern: number | number[]): void {
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
  /** Light tap — for routine actions (draw, undo, untap, tap-permanent). */
  tap(): void {
    if (!enabled) return;
    if (isNativePlatform()) nativeImpact(ImpactStyle.Light);
    else webVibrate(10);
  },

  /** Success cue — for completed actions (card scan landed). */
  success(): void {
    if (!enabled) return;
    if (isNativePlatform()) nativeNotify(NotificationType.Success);
    else webVibrate(40);
  },

  /** Warning cue — for destructive/coarse actions (mulligan, reset). */
  warning(): void {
    if (!enabled) return;
    if (isNativePlatform()) nativeNotify(NotificationType.Warning);
    else webVibrate([20, 30, 20]);
  },

  /** Game-ending hit — a player went to lethal. */
  lethal(): void {
    if (!enabled) return;
    if (isNativePlatform()) nativeImpact(ImpactStyle.Heavy);
    else webVibrate([20, 40, 60]);
  },

  /** Player eliminated — a sharper, repeating cue. */
  eliminate(): void {
    if (!enabled) return;
    if (isNativePlatform()) nativeNotify(NotificationType.Error);
    else webVibrate([30, 30, 30]);
  },
};
