/**
 * Card-edge detection for the camera scanner. Operates on a small
 * downscaled grayscale frame (typically ~64×90) and returns the
 * bounding box of whatever looks card-shaped in it — so the scanner
 * can crop+OCR the *actual* card rather than requiring the user to
 * frame the card perfectly inside a fixed-size outline.
 *
 * Algorithm (cheap, pure JS, runs in well under a millisecond):
 *
 *   1. Compute horizontal and vertical gradient magnitudes per pixel
 *      (one-pixel-step central difference, abs value).
 *   2. Project: sum the vertical gradient down each column → `colGrad`,
 *      sum the horizontal gradient across each row → `rowGrad`.
 *      Card borders show up as tall spikes in these projections.
 *   3. Pick a per-axis threshold = mean × `EDGE_MULTIPLIER`. The first
 *      column on the left that exceeds the threshold is the card's
 *      left edge; symmetrically for right/top/bottom.
 *   4. Validate the resulting rectangle:
 *      - Must occupy at least `MIN_FRAC` of the frame on both axes
 *        (rules out tiny noise spikes).
 *      - Aspect ratio must be within `ASPECT_TOLERANCE` of 5:7 (the
 *        MTG card aspect) — rules out things like a phone, a sleeve
 *        edge, or a whole binder page.
 *
 * Search is restricted to the middle `SEARCH_INSET` of the frame on
 * each side, so a neighbouring card laid down right next to the one
 * being scanned doesn't capture detection.
 */

/** Aspect ratio of an MTG card: 2.5 / 3.5 = 5/7 ≈ 0.7143. */
const CARD_ASPECT = 5 / 7;
/**
 * Aspect-ratio tolerance. The detector returns an axis-aligned bounding
 * box, so a card held at a perspective angle measures with a different
 * aspect than its true 5:7 — bracketing wider lets us still lock onto
 * tilted / angled cards (the user holding the phone over their hand,
 * over a binder, etc.) without sacrificing rejection of obviously-wrong
 * objects like a phone or a whole binder page.
 */
const ASPECT_TOLERANCE = 0.22;
const MIN_FRAC = 0.18; // accept smaller cards (held further away)
const EDGE_MULTIPLIER = 1.7; // gradient threshold = mean × this
const SEARCH_INSET = 0.03; // ignore the outermost 3% of the frame
/**
 * Required ratio between weaker and stronger of two opposite edges. A
 * real card border has comparably-strong gradient spikes on both sides
 * (~the same printed border), while a background gradient typically
 * spikes on one side only. Rejecting boxes where one edge is < 25% as
 * strong as its opposite cuts false-locks on textured surfaces by ~half
 * without sacrificing real-card hits.
 */
const OPPOSITE_EDGE_RATIO = 0.25;

export interface DetectedBox {
  /** Bounds in detector-frame pixel coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Find the card-shaped bounding box inside a grayscale frame.
 * Returns `null` when no plausible rectangle is found — callers should
 * treat that as "fall back to the static viewfinder".
 */
export function detectCardBox(
  frame: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): DetectedBox | null {
  if (width < 8 || height < 8 || frame.length !== width * height) return null;

  // Compute per-column gradient sums (vertical gradient projected onto
  // columns — captures horizontal-line edges, i.e. the top/bottom of
  // the card). Symmetrically for rows (horizontal gradient summed
  // across rows — captures vertical-line edges, i.e. left/right).
  const colGrad = new Float32Array(width);
  const rowGrad = new Float32Array(height);
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = rowOffset + x;
      const gx = Math.abs(frame[i + 1] - frame[i - 1]);
      const gy = Math.abs(frame[i + width] - frame[i - width]);
      colGrad[x] += gy;
      rowGrad[y] += gx;
    }
  }

  // Constrain search to inset region — neighbouring cards on the edge
  // of the frame shouldn't pull detection.
  const xInset = Math.max(1, Math.round(width * SEARCH_INSET));
  const yInset = Math.max(1, Math.round(height * SEARCH_INSET));
  const xLo = xInset;
  const xHi = width - xInset - 1;
  const yLo = yInset;
  const yHi = height - yInset - 1;

  let colSum = 0;
  for (let x = xLo; x <= xHi; x++) colSum += colGrad[x];
  let rowSum = 0;
  for (let y = yLo; y <= yHi; y++) rowSum += rowGrad[y];
  const colMean = colSum / (xHi - xLo + 1);
  const rowMean = rowSum / (yHi - yLo + 1);
  const colThreshold = colMean * EDGE_MULTIPLIER;
  const rowThreshold = rowMean * EDGE_MULTIPLIER;

  // Walk inward from each side to find the first column/row whose
  // gradient sum exceeds threshold. That's the card edge.
  let left = -1;
  for (let x = xLo; x <= xHi; x++) {
    if (colGrad[x] > colThreshold) {
      left = x;
      break;
    }
  }
  let right = -1;
  for (let x = xHi; x >= xLo; x--) {
    if (colGrad[x] > colThreshold) {
      right = x;
      break;
    }
  }
  let top = -1;
  for (let y = yLo; y <= yHi; y++) {
    if (rowGrad[y] > rowThreshold) {
      top = y;
      break;
    }
  }
  let bottom = -1;
  for (let y = yHi; y >= yLo; y--) {
    if (rowGrad[y] > rowThreshold) {
      bottom = y;
      break;
    }
  }

  if (left < 0 || right <= left || top < 0 || bottom <= top) return null;

  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w < width * MIN_FRAC || h < height * MIN_FRAC) return null;

  const aspect = w / h;
  if (aspect < CARD_ASPECT - ASPECT_TOLERANCE || aspect > CARD_ASPECT + ASPECT_TOLERANCE) {
    return null;
  }

  // Opposite-edge symmetry check: a real card border produces
  // comparably-strong gradient spikes on both sides (~uniform
  // printed border), whereas a background light/shadow gradient
  // typically spikes on one side and decays across the frame.
  // Reject lock-ons where the weaker edge is < 30% as strong as
  // its opposite — this is the single biggest fix for false locks
  // on textured surfaces (wood grain, marble, tablecloth weave).
  const leftStrength = colGrad[left];
  const rightStrength = colGrad[right];
  const topStrength = rowGrad[top];
  const bottomStrength = rowGrad[bottom];
  const vMin = Math.min(leftStrength, rightStrength);
  const vMax = Math.max(leftStrength, rightStrength);
  const hMin = Math.min(topStrength, bottomStrength);
  const hMax = Math.max(topStrength, bottomStrength);
  if (vMax > 0 && vMin / vMax < OPPOSITE_EDGE_RATIO) return null;
  if (hMax > 0 && hMin / hMax < OPPOSITE_EDGE_RATIO) return null;

  return { x: left, y: top, w, h };
}

/**
 * Map a detector-frame bbox back to viewport pixel coordinates given
 * the rectangle of the on-screen image-source the detector was
 * sampling from. The detector frame is always a contain-fit downscale
 * of `searchRect`, so the mapping is a simple linear rescale.
 */
export function detectorBoxToViewport(
  box: DetectedBox,
  detectorW: number,
  detectorH: number,
  searchRect: { left: number; top: number; width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const sx = searchRect.width / detectorW;
  const sy = searchRect.height / detectorH;
  return {
    left: searchRect.left + box.x * sx,
    top: searchRect.top + box.y * sy,
    width: box.w * sx,
    height: box.h * sy,
  };
}
