// Scanner: tells same-art printings apart by the card's bottom-left info line.
//
// The matcher compares the ART window only (pHash + CLIP over Scryfall's
// `art_crop`), and the info block sits outside it by design. Two printings
// that share an illustration therefore score identically and the matcher
// hands back whichever it ranks first. What separates them on the card itself
// is the collector number, the set code, and sometimes the frame.
//
// This is not OCR. The warped scan is 488x680, the same size as Scryfall's
// `normal` image, so each candidate printing's own image is a reference for
// what its info line looks like at the scan's scale. We line the scan's info
// band up with each candidate's band, look only at the pixels where the
// candidates actually disagree (the digits and letters that differ), and pick
// the candidate the scan agrees with. No glyph bank, no model, no download
// beyond the candidates' images.
//
// Silence beats a wrong answer: when the best candidate does not clearly beat
// the runner-up, `pickByInfoStrip` returns null and the caller keeps the
// matcher's own choice.
//
// DOM-free on purpose (`GrayImage` in, an index out) so the evaluation
// harness can run it in node against rendered card images.

export interface GrayImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** The info band on the 488x680 warp: set code, collector number, frame edge. */
export const INFO_BAND = { x: 12, y: 612, width: 292, height: 62 } as const;

/** How far (px) a scan's band may sit from a reference's, either axis. */
const MAX_SHIFT = 4;
/** The winner's error must be at most this fraction of the runner-up's. */
export const MAX_ERROR_RATIO = 0.7;
/** Below this many differing pixels the candidates look alike: do not guess. */
const MIN_DISCRIMINATING_WEIGHT = 12;

/** Blur radius (px) applied before comparing: forgives sub-pixel misalignment and camera softness. */
const BLUR = 1;

/** Crop the band, plus `pad` px on every side, into a blurred, z-scored float image. */
function band(img: GrayImage, pad: number): { data: Float32Array; width: number; height: number } {
  const width = INFO_BAND.width + pad * 2;
  const height = INFO_BAND.height + pad * 2;
  const raw = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const sx = Math.min(img.width - 1, Math.max(0, INFO_BAND.x - pad + c));
      const sy = Math.min(img.height - 1, Math.max(0, INFO_BAND.y - pad + r));
      raw[r * width + c] = Number(img.data[sy * img.width + sx]);
    }
  }
  const tmp = new Float32Array(raw.length);
  const out = new Float32Array(raw.length);
  const k = BLUR * 2 + 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let a = 0;
      for (let d = -BLUR; d <= BLUR; d++)
        a += raw[r * width + Math.min(width - 1, Math.max(0, c + d))];
      tmp[r * width + c] = a / k;
    }
  }
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let a = 0;
      for (let d = -BLUR; d <= BLUR; d++)
        a += tmp[Math.min(height - 1, Math.max(0, r + d)) * width + c];
      out[r * width + c] = a / k;
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i];
  const mean = sum / out.length;
  let varSum = 0;
  for (let i = 0; i < out.length; i++) varSum += (out[i] - mean) ** 2;
  const sd = Math.sqrt(varSum / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
  return { data: out, width, height };
}

/** Sum of squared differences between the query band and a shifted window. */
function shiftedError(
  query: Float32Array,
  ref: { data: Float32Array; width: number },
  dx: number,
  dy: number,
  w?: Float32Array
): number {
  let err = 0;
  let wsum = 0;
  const qw = INFO_BAND.width;
  const qh = INFO_BAND.height;
  for (let r = 0; r < qh; r++) {
    for (let c = 0; c < qw; c++) {
      const d = query[r * qw + c] - ref.data[(r + MAX_SHIFT + dy) * ref.width + c + MAX_SHIFT + dx];
      const wt = w ? w[r * qw + c] : 1;
      err += wt * d * d;
      wsum += wt;
    }
  }
  return wsum > 0 ? err / wsum : Infinity;
}

/**
 * Index of the candidate whose info band the scan matches, or null when the
 * scan can't tell. `scan` and every candidate are full 488x680 luminance
 * warps. Needs at least two candidates.
 */
export function pickByInfoStrip(scan: GrayImage, candidates: GrayImage[]): number | null {
  if (candidates.length < 2) return null;
  const q = band(scan, 0).data;
  const refs = candidates.map((c) => band(c, MAX_SHIFT));

  // 1. Line each candidate up with the scan on the whole band.
  const aligned = refs.map((ref) => {
    let best = Infinity;
    let bdx = 0;
    let bdy = 0;
    for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
      for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
        const e = shiftedError(q, ref, dx, dy);
        if (e < best) {
          best = e;
          bdx = dx;
          bdy = dy;
        }
      }
    }
    const out = new Float32Array(INFO_BAND.width * INFO_BAND.height);
    for (let r = 0; r < INFO_BAND.height; r++) {
      for (let c = 0; c < INFO_BAND.width; c++) {
        out[r * INFO_BAND.width + c] =
          ref.data[(r + MAX_SHIFT + bdy) * ref.width + c + MAX_SHIFT + bdx];
      }
    }
    return out;
  });

  // 2. Weight each pixel by how much the aligned candidates disagree there.
  const n = INFO_BAND.width * INFO_BAND.height;
  const weight = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let mean = 0;
    for (const a of aligned) mean += a[i];
    mean /= aligned.length;
    let v = 0;
    for (const a of aligned) v += (a[i] - mean) ** 2;
    weight[i] = v / aligned.length;
    total += weight[i];
  }
  if (total < MIN_DISCRIMINATING_WEIGHT) return null;

  // 3. Score each candidate on those pixels only.
  const errors = aligned.map((a) => {
    let err = 0;
    for (let i = 0; i < n; i++) err += weight[i] * (q[i] - a[i]) ** 2;
    return err / total;
  });
  let best = 0;
  for (let i = 1; i < errors.length; i++) if (errors[i] < errors[best]) best = i;
  let second = Infinity;
  for (let i = 0; i < errors.length; i++) if (i !== best && errors[i] < second) second = errors[i];
  return errors[best] <= second * MAX_ERROR_RATIO ? best : null;
}
