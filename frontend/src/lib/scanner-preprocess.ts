/**
 * Image preprocessing for the card scanner's OCR step, plus post-OCR
 * candidate generation for common Tesseract misreads.
 *
 * Why this exists: card titles are set in Beleren on top of warm parchment,
 * shaded mana plates, or art bleed. Mean-shift contrast (the previous
 * preprocessing) leaves a noisy grayscale image that Tesseract — trained on
 * crisp printed text — chokes on. Otsu's method picks a per-image binarization
 * threshold from the intensity histogram, producing a clean black-on-white
 * (or white-on-black, post-invert) image that meaningfully boosts hit rate.
 *
 * The OCR-candidate helpers cover the *other* big source of failed scans:
 * Tesseract reads "Evolving Wilds" as "Evoiving Wiids" or "Spellcraft" as
 * "Spelloraft", and Scryfall's fuzzy matcher won't always bridge the gap.
 * Generating a small set of plausible alternates (with rn↔m, cl↔d, etc.
 * substitutions) lets the matcher try the variants in order, dramatically
 * improving recognition of stylised titles.
 */

/**
 * Otsu's method: walk every possible threshold and pick the one that
 * maximises between-class variance — i.e. the threshold that separates
 * "ink" from "paper" most cleanly on this specific frame.
 *
 * Returns the optimal threshold (0..255). Operates on the first channel
 * (R) of an RGBA buffer because callers feed it post-grayscale data where
 * R=G=B; this avoids an unnecessary second grayscale pass.
 */
export function otsuThreshold(rgba: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256);
  const pixelCount = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) histogram[rgba[i]]++;

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = -1;
  let bestThreshold = 127;

  for (let t = 0; t < 256; t++) {
    weightBg += histogram[t];
    if (weightBg === 0) continue;
    const weightFg = pixelCount - weightBg;
    if (weightFg === 0) break;

    sumBg += t * histogram[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const diff = meanBg - meanFg;
    // Between-class variance — proportional, the leading factors cancel
    // out so we can skip dividing by pixelCount.
    const variance = weightBg * weightFg * diff * diff;
    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

/**
 * Convert RGBA → grayscale (in-place on the R/G/B channels). Returns the
 * mean luminance so callers can branch on whether the image looks like
 * dark-on-light or light-on-dark without a second pass over the buffer.
 *
 * Uses ITU-R BT.601 luma weights (0.299 R + 0.587 G + 0.114 B), the
 * standard for legacy SDR video — perceptually close to human luminance
 * sensitivity, which is what Tesseract's training data simulates.
 */
export function grayscaleInPlace(rgba: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const g = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = g;
    sum += g;
  }
  return sum / (rgba.length / 4);
}

/**
 * Binarise an RGBA buffer using a fixed threshold. Standard OpenCV
 * convention: pixels with value > threshold are foreground (white),
 * pixels with value ≤ threshold are background (black). `invert`
 * swaps the two — set it true when the original image has light text
 * on a dark background, so the output ends up dark text on light
 * paper (Tesseract's preferred orientation).
 */
export function binarize(rgba: Uint8ClampedArray, threshold: number, invert: boolean): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const isDark = rgba[i] <= threshold;
    // OCR-friendly orientation is dark text on light paper:
    //   invert=false: original is already dark-on-light — keep dark
    //                 pixels dark (they're the ink).
    //   invert=true:  original is light-on-dark — flip so the dark
    //                 (text) pixels end up the bright ones.
    const out = isDark !== invert ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = out;
  }
}

/**
 * Full preprocess pipeline for a title crop: grayscale → Otsu → binarize
 * with auto-chosen polarity. Writes back to the canvas in place.
 *
 * Polarity is chosen by sampling the corners (which are nearly always
 * the *background* of the title plate — the title text sits in the
 * middle of the band, never bleeds to the edges). If the corner mean
 * is bright, the original is dark-text-on-light (invert=false). If the
 * corner mean is dark, the original is light-text-on-dark (invert=true).
 *
 * Returns `{ threshold, inverted }` for logging / debugging.
 */
export function preprocessTitle(ctx: CanvasRenderingContext2D): {
  threshold: number;
  inverted: boolean;
} {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  grayscaleInPlace(data);
  const threshold = otsuThreshold(data);

  // Sample the four corners (8% inset on each side, ~5px box at typical
  // scale) — that's always the title-plate background, never text.
  const corner = Math.max(1, Math.round(Math.min(w, h) * 0.08));
  let cornerSum = 0;
  let cornerCount = 0;
  const accumulate = (x0: number, y0: number) => {
    const x1 = Math.min(w, x0 + corner);
    const y1 = Math.min(h, y0 + corner);
    for (let y = y0; y < y1; y++) {
      const row = y * w * 4;
      for (let x = x0; x < x1; x++) {
        cornerSum += data[row + x * 4];
        cornerCount++;
      }
    }
  };
  accumulate(0, 0);
  accumulate(w - corner, 0);
  accumulate(0, h - corner);
  accumulate(w - corner, h - corner);
  const cornerMean = cornerCount > 0 ? cornerSum / cornerCount : 128;

  // If the background (corners) is bright the text is dark — keep
  // orientation. If the background is dark the text is light — invert
  // so the output ends up dark-on-light for Tesseract.
  const inverted = cornerMean < threshold;
  binarize(data, threshold, inverted);
  ctx.putImageData(img, 0, 0);
  return { threshold, inverted };
}

/**
 * Strip everything that isn't a card-title character and collapse runs of
 * whitespace. Use after OCR but before generating candidates — keeps the
 * candidate set small and focused.
 */
function normalizeOcrText(text: string): string {
  return text
    .replace(/[^A-Za-z',\- /]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tesseract substitutions: maps from common misreads → the character(s) the
 * model probably meant. Ordered roughly by frequency on the Beleren title
 * font; the most-likely fix is applied first.
 *
 * These are intentionally *conservative*. Aggressive substitution (e.g.
 * blindly replacing every 'I' with 'l') can turn a correct read into an
 * incorrect one; we only generate variants for substrings that genuinely
 * confuse OCR on stylised type.
 */
const SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/cl/g, 'd'],
  [/vv/g, 'w'],
  [/\|/g, 'I'],
  [/0/g, 'O'],
  [/1/g, 'I'],
  [/5/g, 'S'],
  [/8/g, 'B'],
  [/Il/g, 'll'],
  [/lI/g, 'll'],
  [/ii/g, 'n'],
];

/**
 * Generate a small ranked list of plausible interpretations of an OCR
 * result, starting with the raw text. Used by the matcher to try each
 * variant in order against Scryfall before giving up.
 *
 * Caps at ~6 candidates: more than that and we're just throwing darts.
 * Each substitution is applied independently (not combinatorially) so
 * the list stays focused on single-error corrections — which is what
 * Tesseract actually produces on title-font misreads.
 */
export function ocrCandidates(raw: string): string[] {
  const base = normalizeOcrText(raw);
  if (!base) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const trimmed = s.trim();
    if (!trimmed || trimmed.length < 2) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  push(base);
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    if (out.length >= 6) break;
    if (!pattern.test(base)) continue;
    push(base.replace(pattern, replacement));
  }
  // Title-prefix fallback: if Tesseract read "Evolving Wilds Land Sacrifice"
  // (line-bleed picked up subtype/text), the first 1–2 words are usually
  // the actual title.
  const words = base.split(' ');
  if (words.length > 2) push(words.slice(0, 2).join(' '));
  if (words.length > 1) push(words[0]);

  return out;
}
