import { useState } from 'react';
import { consumedRevealKeys, __resetRevealRegistryForTests } from './use-animated-number';

// Re-export so callers that only need the cascade reset can import from here.
export { __resetRevealRegistryForTests };

const MAX_STAGGER = 6;

/**
 * Pure helper — returns the CSS class string for a panel at index `i` during
 * a cascade. Use directly in JSX className expressions.
 *
 * @param i      Panel index (0-based). Slots beyond 5 are capped at slot 5.
 * @param active Whether the cascade is currently active.
 */
export function panelCascadeClass(i: number, active: boolean): string {
  if (!active) return '';
  const slot = Math.min(i, MAX_STAGGER - 1);
  return `panel-cascade-enter panel-cascade-enter-${slot}`;
}

function isReducedMotionSync(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Tracks whether a panel cascade should play, keyed to a caller-supplied
 * computation identity string (cascadeKey).
 *
 * Uses the same module-level consumed-set as useAnimatedNumber so a
 * remount (e.g. stats→power→stats) never replays the cascade.
 *
 * - When `cascadeKey` is null/undefined: cascade never plays.
 * - When `cascadeKey` is a non-null string not yet consumed: plays once.
 * - Once consumed, any remount with the same key returns animating: false.
 * - Respects prefers-reduced-motion.
 */
export function usePanelCascade(cascadeKey: string | null | undefined): { animating: boolean } {
  // consumedRevealKeys is module-level (not a ref), safe to read during render.
  // Compute whether cascade should play: key present, not yet consumed, motion ok.
  const shouldPlay = !!cascadeKey && !consumedRevealKeys.has(cascadeKey) && !isReducedMotionSync();

  // Consume the key now (during render) so concurrent instances don't double-fire.
  // consumedRevealKeys is a plain module-level Set (not React state/ref), so
  // reads/writes during render have no React correctness implications.
  if (shouldPlay && cascadeKey) {
    consumedRevealKeys.add(cascadeKey);
  } else if (cascadeKey && !consumedRevealKeys.has(cascadeKey) && isReducedMotionSync()) {
    // Reduced motion: consume without playing
    consumedRevealKeys.add(cascadeKey);
  }

  const [trackedKey, setTrackedKey] = useState<string | null | undefined>(cascadeKey);
  const [animating, setAnimating] = useState<boolean>(shouldPlay);

  // When cascadeKey changes (e.g. new analysis), use render-phase derived-state
  // reset — the official React pattern for syncing derived state from props.
  if (cascadeKey !== trackedKey) {
    setTrackedKey(cascadeKey);
    if (cascadeKey && !consumedRevealKeys.has(cascadeKey) && !isReducedMotionSync()) {
      consumedRevealKeys.add(cascadeKey);
      if (!animating) setAnimating(true);
    } else if (animating) {
      setAnimating(false);
    }
  }

  return { animating };
}
