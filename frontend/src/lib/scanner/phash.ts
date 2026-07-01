// 64-bit DCT-based perceptual hash (pHash) — frontend twin.
//
// MUST stay byte-identical with backend/src/scanner/phash.ts. Both copies
// are exercised against the same 32×32 gradient fixture in unit tests; the
// shared golden hash catches algorithmic drift between the two
// implementations. When this algorithm has to change, regenerate the
// golden and update BOTH tests in the same commit.
//
// Pixel acquisition (decoding the warped 488×680 canvas into a 32×32
// grayscale buffer) is platform-specific — see `hashWarpedCanvas` below.
// Backend uses sharp; we use canvas drawImage + getImageData + luminance.
// Subtle differences in resampling between sharp (libvips) and the browser
// canvas mean the same source can produce hashes a few bits apart, which
// is exactly what Hamming-distance matching tolerates.

export const PHASH_INPUT_SIZE = 32;
export const PHASH_BLOCK = 8;

export function computePHash(gray32x32: Uint8Array | Uint8ClampedArray): bigint {
  if (gray32x32.length !== PHASH_INPUT_SIZE * PHASH_INPUT_SIZE) {
    throw new Error(
      `pHash expects a ${PHASH_INPUT_SIZE}×${PHASH_INPUT_SIZE} grayscale buffer, got ${gray32x32.length} bytes`
    );
  }

  const dct = dct2dSquare(gray32x32, PHASH_INPUT_SIZE);

  const lowFreq = new Float64Array(PHASH_BLOCK * PHASH_BLOCK);
  for (let y = 0; y < PHASH_BLOCK; y++) {
    for (let x = 0; x < PHASH_BLOCK; x++) {
      lowFreq[y * PHASH_BLOCK + x] = dct[y * PHASH_INPUT_SIZE + x];
    }
  }

  // Median of the 63 non-DC values; sort a copy so the original block order
  // is preserved for the bit comparison below.
  const sortable = Array.from(lowFreq.slice(1));
  sortable.sort((a, b) => a - b);
  const median = sortable[Math.floor(sortable.length / 2)];

  let hash = 0n;
  for (let i = 0; i < PHASH_BLOCK * PHASH_BLOCK; i++) {
    if (lowFreq[i] > median) {
      hash |= 1n << BigInt(i);
    }
  }
  return hash;
}

function dct2dSquare(input: Uint8Array | Uint8ClampedArray, n: number): Float64Array {
  const cos = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    for (let x = 0; x < n; x++) {
      cos[k * n + x] = Math.cos(((2 * x + 1) * k * Math.PI) / (2 * n));
    }
  }
  const sqrt1_2 = Math.SQRT1_2;

  const intermediate = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const rowOffset = y * n;
    for (let u = 0; u < n; u++) {
      let sum = 0;
      const cosRow = u * n;
      for (let x = 0; x < n; x++) {
        sum += input[rowOffset + x] * cos[cosRow + x];
      }
      const cu = u === 0 ? sqrt1_2 : 1;
      intermediate[rowOffset + u] = cu * sum;
    }
  }

  const result = new Float64Array(n * n);
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      const cosRow = v * n;
      for (let y = 0; y < n; y++) {
        sum += intermediate[y * n + u] * cos[cosRow + y];
      }
      const cv = v === 0 ? sqrt1_2 : 1;
      result[v * n + u] = cv * sum;
    }
  }
  return result;
}

/** Hamming distance between two 64-bit hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Approximate art-window rectangle on a warped 488×680 modern-frame Magic
 * card, as fractions of the full warp dimensions. Backend pHashes come from
 * Scryfall's `art_crop` which is just this rectangle — hashing the full
 * card on the frontend would compare apples to oranges, producing
 * uniformly-mediocre Hamming distances regardless of input.
 *
 * Coordinates target the M15+ frame (~2014 onward). Old-frame cards have a
 * slightly different art window and may need a per-era refinement once we
 * have matching data to tune against.
 */
export const ART_REGION = {
  xFrac: 0.078,
  yFrac: 0.108,
  widthFrac: 0.844,
  heightFrac: 0.413,
} as const;

/**
 * Whole-card art window for **full-art** cards (basic lands, borderless,
 * full-art promos), whose illustration fills the entire card — so Scryfall's
 * `art_crop` is ~the whole card, not the {@link ART_REGION} band. The scanner
 * tries this crop as a second pass when the {@link ART_REGION} crop doesn't
 * match confidently; without it, every full-art card misses (the band crops
 * the wrong region entirely).
 *
 * The window is **top-biased** — it drops the bottom ~14% and top ~6% of the
 * card, where full-art frames overlay the name/type line and the
 * set/collector/artist band that Scryfall's `art_crop` excludes. Cropping
 * those off matches the reference framing far more tightly: full-art scans
 * land CONFIDENT (~111-116 raw) instead of merely BORDERLINE (~93-103), which
 * is the margin a real foil scan (glare lowers the score) needs to resolve
 * cleanly instead of surfacing an "ambiguous match" picker. Validated against
 * Scryfall `art_crop` references for full-art basics across sets, with no
 * false-confident matches on normal cards. Tune here if a per-era refinement
 * is ever needed.
 */
export const FULL_ART_REGION = {
  xFrac: 0.08,
  yFrac: 0.06,
  widthFrac: 0.84,
  heightFrac: 0.8,
} as const;

export type CropRegion = {
  xFrac: number;
  yFrac: number;
  widthFrac: number;
  heightFrac: number;
};

/**
 * Crop a fractional window out of a warped card canvas. Returns a new canvas
 * sized to the window so callers can `imshow`-style preview it.
 */
export function cropRegion(warped: HTMLCanvasElement, region: CropRegion): HTMLCanvasElement {
  const x = Math.round(warped.width * region.xFrac);
  const y = Math.round(warped.height * region.yFrac);
  const w = Math.round(warped.width * region.widthFrac);
  const h = Math.round(warped.height * region.heightFrac);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for art crop');
  ctx.drawImage(warped, x, y, w, h, 0, 0, w, h);
  return out;
}

/** Crop the normal-frame art window. See {@link ART_REGION}. */
export function cropArtRegion(warped: HTMLCanvasElement): HTMLCanvasElement {
  return cropRegion(warped, ART_REGION);
}

/** Crop the whole-card window for full-art cards. See {@link FULL_ART_REGION}. */
export function cropFullArtRegion(warped: HTMLCanvasElement): HTMLCanvasElement {
  return cropRegion(warped, FULL_ART_REGION);
}

/**
 * Compute a pHash from a warped card canvas (typically 488×680). The art
 * window is cropped out first so the resulting hash compares against the
 * backend's `art_crop`-derived hashes, not the full-card image. Resizing to
 * INPUT_SIZE × INPUT_SIZE → RGBA → BT.601 luminance happens on a scratch
 * canvas; the conversion weights match sharp's default greyscale.
 */
export function hashCanvas(source: HTMLCanvasElement): bigint {
  const art = cropArtRegion(source);

  const tmp = document.createElement('canvas');
  tmp.width = PHASH_INPUT_SIZE;
  tmp.height = PHASH_INPUT_SIZE;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable for pHash resize');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art, 0, 0, PHASH_INPUT_SIZE, PHASH_INPUT_SIZE);

  const imageData = ctx.getImageData(0, 0, PHASH_INPUT_SIZE, PHASH_INPUT_SIZE);
  const rgba = imageData.data;
  const gray = new Uint8Array(PHASH_INPUT_SIZE * PHASH_INPUT_SIZE);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    // BT.601 luminance — matches sharp's default greyscale conversion.
    gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return computePHash(gray);
}
