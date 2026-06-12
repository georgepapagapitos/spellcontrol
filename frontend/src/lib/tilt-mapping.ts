/**
 * Pure mapping functions for gyro-to-tilt translation.
 *
 * Extracted so the math can be unit-tested without any DOM or React dependency.
 * The useHolographic hook feeds the result into its existing lerp pipeline —
 * the CSS vars, rAF loop, and clamp range are all untouched.
 *
 * Axis conventions (match the CSS card convention):
 *   rx  — rotation around the X-axis (pitch: tilting the top toward/away from you)
 *   ry  — rotation around the Y-axis (roll:  tilting the left/right edge)
 *
 * Device-orientation coordinate system (standard W3C):
 *   beta  — front-back tilt,  -180..180 (0 = flat face-up)
 *   gamma — left-right tilt,  -90..90   (0 = flat face-up)
 *
 * Mapping:
 *   beta delta  →  rx  (positive delta = top tilts toward user → positive rx)
 *   gamma delta →  ry  (positive delta = right side tilts toward user → positive ry)
 */

/** Maximum tilt angle in degrees that the lerp pipeline accepts. */
const MAX_TILT_DEG = 7;

/**
 * Device orientation sample. Mirrors the W3C DeviceOrientationEvent fields
 * we care about; null if the browser hasn't provided a value yet.
 */
export interface OrientationSample {
  beta: number | null;
  gamma: number | null;
}

/**
 * Tilt target fed into the existing useHolographic lerp pipeline.
 * mx/my are the glare position (0–100 percentage, matching the CSS convention).
 */
export interface TiltTarget {
  rx: number;
  ry: number;
  mx: number;
  my: number;
}

/**
 * Capture a baseline orientation (the phone's "neutral" angle when the preview
 * opens). Returns null if either field is missing.
 */
export function captureBaseline(sample: OrientationSample): OrientationSample | null {
  if (sample.beta === null || sample.gamma === null) return null;
  return { beta: sample.beta, gamma: sample.gamma };
}

/**
 * Map a device-orientation delta (current - baseline) to a tilt target.
 *
 * @param current  - live orientation reading
 * @param baseline - the neutral reference captured at preview-open
 * @returns TiltTarget with rx/ry clamped to ±MAX_TILT_DEG and mx/my for glare
 */
export function mapOrientationToTilt(
  current: OrientationSample,
  baseline: OrientationSample
): TiltTarget {
  // If either axis is unavailable, return the neutral position.
  if (current.beta === null || current.gamma === null) {
    return { rx: 0, ry: 0, mx: 50, my: 50 };
  }

  const deltaBeta = current.beta - (baseline.beta ?? 0);
  const deltaGamma = current.gamma - (baseline.gamma ?? 0);

  // Clamp each axis to ±MAX_TILT_DEG — same range as the cursor path.
  const rx = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, deltaBeta));
  const ry = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, deltaGamma));

  // Map tilt to a glare position in 0–100 percentage space.
  // rx positive (top tilted forward) → glare moves toward the bottom (my > 50).
  // ry positive (right side down)    → glare moves toward the right (mx > 50).
  const mx = 50 + (ry / MAX_TILT_DEG) * 50;
  const my = 50 - (rx / MAX_TILT_DEG) * 50;

  return { rx, ry, mx, my };
}
