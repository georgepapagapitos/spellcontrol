// Phase 1 preprocessing: CLAHE (Contrast Limited Adaptive Histogram
// Equalization) implemented in pure JS so it works against the official
// opencv.js build (which excludes `createCLAHE`/`equalizeHist`). The
// backend's reference hashes come from Scryfall's professionally-lit
// `art_crop` images, so the closer the query looks to that baseline, the
// lower the Hamming distance on the right card. CLAHE pulls dim corners
// up and pushes blown highlights down without flattening the image overall
// — it's the canonical fix for phone-camera lighting variance.
//
// We operate on grayscale luminance, not RGB: pHash works on luminance
// anyway, and a single-channel pipeline is half the loop work. Output is
// rendered into a canvas (gray-in-all-channels) so the spike UI can
// display it side-by-side with the raw warp.

export interface ClaheOptions {
  /** Default 2.0 — higher = more aggressive contrast, more noise amplification. */
  clipLimit?: number;
  /** Tiles along each axis. Default 8 → 8×8 = 64 tiles total. */
  tileGrid?: number;
}

/**
 * Apply CLAHE to a canvas. Returns a new canvas with the equalized
 * grayscale rendered into the RGB channels (alpha=255).
 */
export function applyCLAHE(source: HTMLCanvasElement, opts: ClaheOptions = {}): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('source canvas has no 2D context');
  const w = source.width;
  const h = source.height;
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    // BT.601 luminance — matches sharp's default greyscale conversion so
    // the CLAHE input is comparable to the backend reference pipeline.
    gray[j] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
  }

  const equalized = claheGrayscale(gray, w, h, opts);

  const outCtx = document.createElement('canvas').getContext('2d');
  if (!outCtx) throw new Error('output canvas has no 2D context');
  const out = outCtx.canvas;
  out.width = w;
  out.height = h;
  const outData = outCtx.createImageData(w, h);
  for (let i = 0, j = 0; i < equalized.length; i++, j += 4) {
    outData.data[j] = equalized[i];
    outData.data[j + 1] = equalized[i];
    outData.data[j + 2] = equalized[i];
    outData.data[j + 3] = 255;
  }
  outCtx.putImageData(outData, 0, 0);
  return out;
}

/**
 * Pure-JS CLAHE on a width×height grayscale buffer.
 *
 * Algorithm:
 *   1. Split the image into a tileGrid × tileGrid grid of tiles.
 *   2. For each tile, build a 256-bin histogram of pixel values.
 *   3. Clip the histogram at `clipLimit × pixelsPerTile / 256` per bin;
 *      redistribute the clipped overflow uniformly across all bins.
 *   4. From the clipped histogram, build a CDF-based LUT mapping
 *      input intensity → output intensity for that tile.
 *   5. For each output pixel, bilinearly interpolate between the LUTs of
 *      the four surrounding tile centers. The interpolation is what makes
 *      CLAHE smooth across tile boundaries (vs. naive per-tile equalize
 *      which would emit visible seams).
 */
export function claheGrayscale(
  gray: Uint8Array,
  width: number,
  height: number,
  opts: ClaheOptions = {}
): Uint8Array {
  const tileGrid = opts.tileGrid ?? 8;
  const clipLimit = opts.clipLimit ?? 2.0;
  const tileW = Math.max(1, Math.floor(width / tileGrid));
  const tileH = Math.max(1, Math.floor(height / tileGrid));

  // Build a LUT for each tile. `luts[ty * tileGrid + tx]` is a Uint8Array(256).
  const luts: Uint8Array[] = new Array(tileGrid * tileGrid);
  for (let ty = 0; ty < tileGrid; ty++) {
    for (let tx = 0; tx < tileGrid; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = tx === tileGrid - 1 ? width : x0 + tileW;
      const y1 = ty === tileGrid - 1 ? height : y0 + tileH;
      luts[ty * tileGrid + tx] = buildTileLut(gray, width, x0, y0, x1, y1, clipLimit);
    }
  }

  // Apply via bilinear interpolation between the 4 surrounding tile centers.
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    // Convert pixel y → fractional tile-center y (centers sit at integer
    // grid coords + 0.5 of tile, so we offset by 0.5).
    const ty = y / tileH - 0.5;
    const ty0 = clamp(Math.floor(ty), 0, tileGrid - 1);
    const ty1 = clamp(ty0 + 1, 0, tileGrid - 1);
    const fy = clamp(ty - ty0, 0, 1);

    for (let x = 0; x < width; x++) {
      const tx = x / tileW - 0.5;
      const tx0 = clamp(Math.floor(tx), 0, tileGrid - 1);
      const tx1 = clamp(tx0 + 1, 0, tileGrid - 1);
      const fx = clamp(tx - tx0, 0, 1);

      const v = gray[y * width + x];
      const v00 = luts[ty0 * tileGrid + tx0][v];
      const v10 = luts[ty0 * tileGrid + tx1][v];
      const v01 = luts[ty1 * tileGrid + tx0][v];
      const v11 = luts[ty1 * tileGrid + tx1][v];

      const v0 = v00 * (1 - fx) + v10 * fx;
      const v1 = v01 * (1 - fx) + v11 * fx;
      out[y * width + x] = (v0 * (1 - fy) + v1 * fy) | 0;
    }
  }
  return out;
}

function buildTileLut(
  gray: Uint8Array,
  imgWidth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clipLimit: number
): Uint8Array {
  const hist = new Int32Array(256);
  let pixelCount = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      hist[gray[y * imgWidth + x]]++;
      pixelCount++;
    }
  }

  // Clip and redistribute overflow uniformly. Math.max(1, …) guards a
  // degenerate flat tile from clipping every bin to zero.
  const clip = Math.max(1, ((clipLimit * pixelCount) / 256) | 0);
  let excess = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] > clip) {
      excess += hist[i] - clip;
      hist[i] = clip;
    }
  }
  const bonus = (excess / 256) | 0;
  let remainder = excess - bonus * 256;
  for (let i = 0; i < 256; i++) hist[i] += bonus;
  // Spread the truncated remainder one-per-bin starting from 0.
  for (let i = 0; remainder > 0 && i < 256; i++, remainder--) hist[i]++;

  // CDF → LUT.
  const lut = new Uint8Array(256);
  let sum = 0;
  const scale = pixelCount > 0 ? 255 / pixelCount : 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    const mapped = (sum * scale) | 0;
    lut[i] = mapped > 255 ? 255 : mapped;
  }
  return lut;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
