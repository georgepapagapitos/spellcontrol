/**
 * Timing and step-ramp constants for press-and-hold life adjustment.
 *
 * - `HOLD_DWELL_MS`: how long the pointer must be held before the repeater
 *   starts (the "dwell" window that distinguishes a tap from a hold).
 * - `HOLD_REPEAT_MS`: interval between ticks once the repeater is running.
 * - `HOLD_STEPS`: ramp table of [thresholdMs, stepSize] pairs, sorted
 *   ascending by threshold. After `thresholdMs` ms of hold the tick size
 *   increases to `stepSize`, letting a long hold race to large adjustments
 *   without requiring rapid tapping.
 */

export const HOLD_DWELL_MS = 400;
export const HOLD_REPEAT_MS = 130;

/**
 * Life's long press: one jump of HOLD_JUMP, then another every
 * HOLD_JUMP_REPEAT_MS while held. Slow enough to count along with, and to let
 * go on the number you meant.
 */
export const HOLD_JUMP = 10;
export const HOLD_JUMP_REPEAT_MS = 600;

/**
 * [thresholdMs, stepSize] pairs, sorted ascending by threshold.
 * The first entry's threshold is 0, so it is always the floor.
 */
export const HOLD_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1500, 5],
  [3500, 10],
];

/**
 * Returns the step size for the given elapsed hold time by finding the last
 * HOLD_STEPS entry whose threshold ≤ elapsedMs. Negative or zero inputs
 * clamp to the first entry's step (1).
 */
export function holdStepFor(elapsedMs: number): number {
  if (elapsedMs <= 0) return HOLD_STEPS[0][1];
  let step = HOLD_STEPS[0][1];
  for (const [threshold, size] of HOLD_STEPS) {
    if (elapsedMs >= threshold) step = size;
  }
  return step;
}
