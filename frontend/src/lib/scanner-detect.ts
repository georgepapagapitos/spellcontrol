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
 *   3. Build candidate edge lists by detecting *threshold transitions*
 *      in those projections: rising edges (low→high crossings of
 *      `mean × EDGE_MULTIPLIER`) give left/top candidates; falling
 *      edges give right/bottom. Keep the K strongest per side so
 *      worst-case noisy frames don't blow up the search.
 *   4. Search over (left, right, top, bottom) combinations from those
 *      candidates and pick the rectangle that scores best on:
 *        - aspect ratio closeness to 5:7,
 *        - combined edge strength (sum of 4 picked candidates' gradient),
 *        - opposite-edge symmetry (left vs right, top vs bottom).
 *      Reject candidates that fail size / aspect / symmetry hard limits.
 *
 * Why the search instead of "first row above threshold from each side":
 * environmental edges (desk shadows, the dark band where a phone case
 * meets a tablecloth, the seam of two surfaces) often produce a stronger
 * projected spike than the card's printed border because they extend
 * across the *full* frame width. A naive greedy walk locks onto the
 * environmental line as the "top edge" and the resulting bbox fails the
 * 5:7 aspect check — i.e. the card never gets detected. The candidate-
 * search variant simply skips that wrong combination and finds the next
 * one that gives a valid aspect.
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
/**
 * Edge-presence threshold. A row/column counts as an "edge candidate"
 * if its projected gradient sum exceeds the per-axis mean × this. Lower
 * = more candidates considered, more robust to real-world frames with
 * busy art bleed; higher = faster, more conservative. The candidate-
 * search algorithm below tolerates a generous multiplier — extra
 * candidates get discarded by aspect/size/symmetry scoring, they
 * don't produce false positives.
 */
const EDGE_MULTIPLIER = 1.4;
const SEARCH_INSET = 0.03; // ignore the outermost 3% of the frame
/**
 * Required ratio between weaker and stronger of two opposite edges.
 * Looser than the original 0.30 because phone-camera lighting can
 * meaningfully attenuate one side (e.g. shadow from the phone itself
 * on the right edge of a card held in the left hand). Hard rejection,
 * not a soft penalty, but at a forgiving threshold.
 */
const OPPOSITE_EDGE_RATIO = 0.15;
/**
 * Cap on candidates kept per axis. K=12 means worst-case 12⁴ = 20736
 * combinations to score — still well under a millisecond in JS. Real
 * frames usually produce 2–6 candidates; the cap only matters for
 * pathological "everything is an edge" inputs.
 */
const MAX_CANDIDATES_PER_AXIS = 12;

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

  // Build candidate edge lists by detecting *transitions* across the
  // threshold, not "every cell above threshold". A card produces a
  // STEP function in the projected gradient (high across the whole
  // span of the card, near-zero outside) — so the meaningful edges
  // are the threshold crossings. For a clean card on a clean
  // background that's one rising and one falling edge per axis; in
  // noisy environments (shadow lines, multiple cards, art bleed)
  // there may be several of each and the search step picks the
  // combination that best matches a card.
  //
  // `lefts` are rising edges in colGrad (where colGrad crosses up
  // through threshold reading left→right) and `rights` are falling
  // edges (down through threshold reading left→right). Symmetric
  // for `tops` / `bottoms` in rowGrad.
  const collectEdges = (
    proj: Float32Array,
    lo: number,
    hi: number,
    threshold: number
  ): {
    rises: Array<{ pos: number; strength: number }>;
    falls: Array<{ pos: number; strength: number }>;
  } => {
    const rises: Array<{ pos: number; strength: number }> = [];
    const falls: Array<{ pos: number; strength: number }> = [];
    for (let i = lo; i <= hi; i++) {
      const above = proj[i] > threshold;
      const prevAbove = i > lo ? proj[i - 1] > threshold : false;
      const nextAbove = i < hi ? proj[i + 1] > threshold : false;
      if (above && !prevAbove) rises.push({ pos: i, strength: proj[i] });
      if (above && !nextAbove) falls.push({ pos: i, strength: proj[i] });
    }
    return { rises, falls };
  };
  const { rises: lefts, falls: rights } = collectEdges(colGrad, xLo, xHi, colThreshold);
  const { rises: tops, falls: bottoms } = collectEdges(rowGrad, yLo, yHi, rowThreshold);
  if (lefts.length === 0 || rights.length === 0 || tops.length === 0 || bottoms.length === 0) {
    return null;
  }

  // Cap candidate lists to K strongest to keep the search tractable
  // on pathologically noisy frames. Real frames typically produce
  // 1–4 edges per side; the cap only matters for extreme inputs.
  const trimToTopK = (list: Array<{ pos: number; strength: number }>) => {
    if (list.length <= MAX_CANDIDATES_PER_AXIS) return list;
    const byStrength = list.slice().sort((a, b) => b.strength - a.strength);
    const kept = new Set(byStrength.slice(0, MAX_CANDIDATES_PER_AXIS).map((c) => c.pos));
    return list.filter((c) => kept.has(c.pos));
  };
  const leftsK = trimToTopK(lefts);
  const rightsK = trimToTopK(rights);
  const topsK = trimToTopK(tops);
  const bottomsK = trimToTopK(bottoms);

  // Search over (left, right) × (top, bottom) combinations from those
  // candidates and pick the rectangle that scores best on aspect-ratio
  // closeness to 5:7 plus edge-strength bonus. Hard limits on size,
  // aspect, and opposite-edge symmetry filter out the obviously-wrong
  // combos before scoring.
  //
  // This is what beats environmental false edges (the desk-shadow line
  // above the card, the seam where a tablecloth ends, etc.): the
  // greedy "first row above threshold" picks the environmental edge
  // as `top`, which makes the resulting bbox too tall and fails the
  // 5:7 check — so the search moves on to the next candidate top,
  // which is the card's actual border.
  const aspectMin = CARD_ASPECT - ASPECT_TOLERANCE;
  const aspectMax = CARD_ASPECT + ASPECT_TOLERANCE;
  const minW = width * MIN_FRAC;
  const minH = height * MIN_FRAC;
  const strengthNormaliser = 4 * (colMean + rowMean) + 1;

  let bestScore = -Infinity;
  let bestLeft = -1;
  let bestRight = -1;
  let bestTop = -1;
  let bestBottom = -1;

  for (const leftEdge of leftsK) {
    for (const rightEdge of rightsK) {
      if (rightEdge.pos <= leftEdge.pos) continue;
      const w = rightEdge.pos - leftEdge.pos + 1;
      if (w < minW) continue;
      const leftStrength = leftEdge.strength;
      const rightStrength = rightEdge.strength;
      const vMin = Math.min(leftStrength, rightStrength);
      const vMax = Math.max(leftStrength, rightStrength);
      if (vMax > 0 && vMin / vMax < OPPOSITE_EDGE_RATIO) continue;

      for (const topEdge of topsK) {
        for (const bottomEdge of bottomsK) {
          if (bottomEdge.pos <= topEdge.pos) continue;
          const h = bottomEdge.pos - topEdge.pos + 1;
          if (h < minH) continue;
          const aspect = w / h;
          if (aspect < aspectMin || aspect > aspectMax) continue;
          const topStrength = topEdge.strength;
          const bottomStrength = bottomEdge.strength;
          const hMin = Math.min(topStrength, bottomStrength);
          const hMax = Math.max(topStrength, bottomStrength);
          if (hMax > 0 && hMin / hMax < OPPOSITE_EDGE_RATIO) continue;

          // Score: heavily reward aspect-fit, then add a normalised
          // edge-strength bonus so when two candidates tie on aspect
          // (e.g. card's true border vs an artwork band that happens
          // to span the right width) the stronger-edged one wins.
          const aspectError = Math.abs(aspect - CARD_ASPECT);
          const aspectScore = 1 - aspectError / ASPECT_TOLERANCE;
          const strengthScore =
            (leftStrength + rightStrength + topStrength + bottomStrength) / strengthNormaliser;
          const score = aspectScore * 2 + strengthScore;
          if (score > bestScore) {
            bestScore = score;
            bestLeft = leftEdge.pos;
            bestRight = rightEdge.pos;
            bestTop = topEdge.pos;
            bestBottom = bottomEdge.pos;
          }
        }
      }
    }
  }

  if (bestLeft < 0) return null;
  return {
    x: bestLeft,
    y: bestTop,
    w: bestRight - bestLeft + 1,
    h: bestBottom - bestTop + 1,
  };
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
