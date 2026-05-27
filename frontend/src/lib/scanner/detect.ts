// Phase 0 spike: classical card-quad detection + perspective warp using
// OpenCV.js. Not yet integrated into the live scanner — this is the pipeline
// we measure against real phone photos before committing to Phase 1's pHash
// matcher.
//
// Pipeline: grayscale → blur → Canny → findContours → largest convex 4-pt
// approxPolyDP → perspective-warp to Scryfall's 488×680 "normal" dimensions.
// OpenCV.js Mats are manually refcounted; every allocation goes through the
// scope helper so a thrown error still releases native memory.

import type { OpenCvLoadResult } from './opencv-loader';

export const WARP_WIDTH = 488;
export const WARP_HEIGHT = 680;
const DETECT_LONG_EDGE = 1200;

export interface Point {
  x: number;
  y: number;
}

export interface DetectResult {
  warped: HTMLCanvasElement | null;
  quad: Point[] | null;
  detectMs: number;
  scaledSize: { width: number; height: number };
  reason?: 'no-contours' | 'no-quad' | 'quad-too-small';
}

type Cv = OpenCvLoadResult['cv'];
// The official @techstark types don't cover every cv method we touch (e.g.
// matFromArray, MatVector iteration). Use a structural alias for those calls.
type CvAny = Cv & Record<string, unknown>;

interface Deletable {
  delete(): void;
}
type Scope = {
  track<T extends Deletable>(mat: T): T;
  release(): void;
};

function makeScope(): Scope {
  const owned: Deletable[] = [];
  return {
    track<T extends Deletable>(mat: T): T {
      owned.push(mat);
      return mat;
    },
    release(): void {
      // Release in reverse order so derived Mats are freed before parents.
      for (let i = owned.length - 1; i >= 0; i--) {
        try {
          owned[i].delete();
        } catch {
          // Already deleted or in a bad state — ignore so siblings still release.
        }
      }
    },
  };
}

export async function detectAndWarpCard(
  cv: Cv,
  source: HTMLImageElement | HTMLCanvasElement | ImageData
): Promise<DetectResult> {
  const t0 = performance.now();
  const cvx = cv as CvAny;
  const scope = makeScope();

  try {
    const imageData = toImageData(source);

    // Downscale large inputs so contour detection runs in a predictable
    // budget. The detected quad is rescaled back to the original later.
    const longEdge = Math.max(imageData.width, imageData.height);
    const scale = longEdge > DETECT_LONG_EDGE ? DETECT_LONG_EDGE / longEdge : 1;
    const detectW = Math.round(imageData.width * scale);
    const detectH = Math.round(imageData.height * scale);

    const srcFull = scope.track(cvx.matFromImageData(imageData));
    const src = scope.track(new cvx.Mat());
    if (scale !== 1) {
      cvx.resize(srcFull, src, new cvx.Size(detectW, detectH), 0, 0, cvx.INTER_AREA);
    } else {
      srcFull.copyTo(src);
    }

    const gray = scope.track(new cvx.Mat());
    cvx.cvtColor(src, gray, cvx.COLOR_RGBA2GRAY);

    const blurred = scope.track(new cvx.Mat());
    cvx.GaussianBlur(gray, blurred, new cvx.Size(5, 5), 0, 0, cvx.BORDER_DEFAULT);

    const kernel = scope.track(cvx.getStructuringElement(cvx.MORPH_RECT, new cvx.Size(3, 3)));
    const minArea = detectW * detectH * 0.05;

    // Try Canny with progressively looser thresholds. The default (50, 150)
    // is fine for well-lit cards with strong border-to-background contrast.
    // White-bordered cards on a white playmat, black-bordered on a dark
    // desk, or extended-art / borderless cards have low gradient magnitude
    // at the card edge — looser thresholds rescue those cases at the cost
    // of more false-positive contours that we filter via min-area + convex
    // quad check anyway.
    const tryThresholds = (low: number, high: number): Point[] | null => {
      const edges = scope.track(new cvx.Mat());
      cvx.Canny(blurred, edges, low, high, 3, false);
      // Dilate edges slightly so broken card-border lines reconnect —
      // common on glossy / foil cards where reflections punch holes in
      // the contour.
      cvx.dilate(edges, edges, kernel);
      const contours = scope.track(new cvx.MatVector());
      const hierarchy = scope.track(new cvx.Mat());
      cvx.findContours(edges, contours, hierarchy, cvx.RETR_EXTERNAL, cvx.CHAIN_APPROX_SIMPLE);
      const count = contours.size();
      if (count === 0) return null;
      let best: { quad: Point[]; area: number } | null = null;
      for (let i = 0; i < count; i++) {
        const cnt = contours.get(i);
        try {
          const area = cvx.contourArea(cnt);
          if (area < minArea) continue;
          const peri = cvx.arcLength(cnt, true);
          const approx = new cvx.Mat();
          try {
            cvx.approxPolyDP(cnt, approx, 0.02 * peri, true);
            if (approx.rows !== 4) continue;
            if (!cvx.isContourConvex(approx)) continue;
            const quad: Point[] = [];
            for (let j = 0; j < 4; j++) {
              quad.push({
                x: approx.data32S[j * 2],
                y: approx.data32S[j * 2 + 1],
              });
            }
            if (!best || area > best.area) best = { quad, area };
          } finally {
            approx.delete();
          }
        } finally {
          cnt.delete();
        }
      }
      return best ? best.quad : null;
    };

    const thresholdLadder: Array<[number, number]> = [
      [50, 150], // default — strong contrast cards
      [25, 80], // moderate — low-contrast borders
      [10, 40], // last resort — extended-art / near-identical backgrounds
    ];
    let foundQuad: Point[] | null = null;
    let attempts = 0;
    for (const [low, high] of thresholdLadder) {
      attempts += 1;
      foundQuad = tryThresholds(low, high);
      if (foundQuad) break;
    }

    if (foundQuad) {
      const ordered = orderQuadCorners(foundQuad);
      const warped = warpQuad(cvx, srcFull, ordered, scale, scope);
      const quadOriginal = ordered.map((p) => ({ x: p.x / scale, y: p.y / scale }));
      if (attempts > 1) {
        // eslint-disable-next-line no-console
        console.log(`[scanner] quad found on retry attempt ${attempts}/${thresholdLadder.length}`);
      }
      return {
        warped,
        quad: quadOriginal,
        detectMs: performance.now() - t0,
        scaledSize: { width: detectW, height: detectH },
      };
    }

    // Center-crop fallback. All threshold tries failed to find a card
    // quad — typical for borderless / extended-art cards or cards with
    // poor background contrast. Bet that the auto-fire heuristics
    // already detected card-like content in the center: take a 5:7
    // box at the center of the input, resize to the canonical warp
    // dims, and let the matcher decide. If the score is too low, it
    // falls through to `miss` naturally.
    const fallback = centerCropFallback(cvx, srcFull, detectW, detectH, scale, scope);
    // eslint-disable-next-line no-console
    console.log('[scanner] no quad found — using center-crop fallback');
    return {
      warped: fallback.warped,
      quad: fallback.quad,
      detectMs: performance.now() - t0,
      scaledSize: { width: detectW, height: detectH },
    };
  } finally {
    scope.release();
  }
}

/**
 * Last-resort warp: assume the card occupies a 5:7 portrait box at the
 * center of the input frame. Used only when Canny + contour search
 * failed at every threshold — typical for borderless / extended-art
 * cards or cards with poor background contrast (white on white,
 * black on black). The matcher's own score still gates whether the
 * result is accepted; a wrong center crop scores low and falls
 * through to `miss`.
 */
function centerCropFallback(
  cv: CvAny,
  srcFull: Deletable & { cols: number; rows: number },
  detectW: number,
  detectH: number,
  scale: number,
  scope: Scope
): { warped: HTMLCanvasElement; quad: Point[] } {
  const cardAspect = WARP_WIDTH / WARP_HEIGHT;
  // Pick a 5:7 box at ~85% of the smaller axis (slight inset so we
  // don't capture playmat edges in the crop on edge-to-edge framing).
  const FILL = 0.85;
  let boxW: number;
  let boxH: number;
  if (detectW / detectH > cardAspect) {
    boxH = detectH * FILL;
    boxW = boxH * cardAspect;
  } else {
    boxW = detectW * FILL;
    boxH = boxW / cardAspect;
  }
  const x0 = (detectW - boxW) / 2;
  const y0 = (detectH - boxH) / 2;
  const quadDownscaled: Point[] = [
    { x: x0, y: y0 },
    { x: x0 + boxW, y: y0 },
    { x: x0 + boxW, y: y0 + boxH },
    { x: x0, y: y0 + boxH },
  ];
  const ordered = orderQuadCorners(quadDownscaled);
  const warped = warpQuad(cv, srcFull, ordered, scale, scope);
  const quadOriginal = ordered.map((p) => ({ x: p.x / scale, y: p.y / scale }));
  return { warped, quad: quadOriginal };
}

function warpQuad(
  cv: CvAny,
  srcFull: Deletable & { cols: number; rows: number },
  orderedDownscaled: Point[],
  scale: number,
  scope: Scope
): HTMLCanvasElement {
  // Map the detected corners back to original-image coordinates for a
  // sharper warp (downscaled-to-warped resampling would lose detail).
  const orderedFull = orderedDownscaled.map((p) => [p.x / scale, p.y / scale] as const);

  const srcPts = scope.track(
    cv.matFromArray(4, 1, cv.CV_32FC2 as number, [
      orderedFull[0][0],
      orderedFull[0][1],
      orderedFull[1][0],
      orderedFull[1][1],
      orderedFull[2][0],
      orderedFull[2][1],
      orderedFull[3][0],
      orderedFull[3][1],
    ])
  );
  const dstPts = scope.track(
    cv.matFromArray(4, 1, cv.CV_32FC2 as number, [
      0,
      0,
      WARP_WIDTH - 1,
      0,
      WARP_WIDTH - 1,
      WARP_HEIGHT - 1,
      0,
      WARP_HEIGHT - 1,
    ])
  );

  const M = scope.track(cv.getPerspectiveTransform(srcPts, dstPts));
  const warped = scope.track(new cv.Mat());
  cv.warpPerspective(
    srcFull,
    warped,
    M,
    new cv.Size(WARP_WIDTH, WARP_HEIGHT),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar()
  );

  const out = document.createElement('canvas');
  out.width = WARP_WIDTH;
  out.height = WARP_HEIGHT;
  cv.imshow(out, warped);
  return out;
}

// Sort corners into TL, TR, BR, BL by sum/diff of coordinates — standard
// recipe and stable regardless of which vertex approxPolyDP emitted first.
export function orderQuadCorners(pts: Point[]): Point[] {
  if (pts.length !== 4) throw new Error('orderQuadCorners requires 4 points');
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.y - p.x);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.min(...diffs))];
  const bl = pts[diffs.indexOf(Math.max(...diffs))];
  return [tl, tr, br, bl];
}

function toImageData(source: HTMLImageElement | HTMLCanvasElement | ImageData): ImageData {
  if (source instanceof ImageData) return source;
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
