/**
 * Canvas-based dHash for the card scanner.
 *
 * Implements the exact same bit layout as the backend's `dHashFromLuminance`
 * (backend/src/phash.ts) so a hash produced here lines up byte-for-byte with
 * the hashes computed during ingest. The match endpoint compares hashes with
 * Hamming distance, so small differences from canvas-vs-sharp resampling are
 * absorbed by the distance threshold — we don't need exact pixel parity.
 *
 * The captured frame from the scanner is cropped to the card's art window
 * (roughly y: 12%–53%, x: 7%–93% on a modern frame) BEFORE being passed in
 * here. Hashing the art crop, not the full card, matches what we hashed
 * server-side and dramatically improves discrimination.
 */

export const HASH_BYTES = 8;

/**
 * Pure math: dHash from an RGBA byte buffer that represents a 9x8 image.
 * Extracted so it's unit-testable without a DOM — the canvas variant below
 * just resamples to 9x8 and then calls this. Matches the backend's
 * `dHashFromLuminance` bit layout exactly.
 */
export function dHashFromRgba9x8(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (rgba.length !== 9 * 8 * 4) {
    throw new Error(`dHashFromRgba9x8 expected 288 bytes, got ${rgba.length}`);
  }
  const luma = new Uint8Array(9 * 8);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    luma[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  const out = new Uint8Array(HASH_BYTES);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = luma[row * 9 + col];
      const right = luma[row * 9 + col + 1];
      if (left > right) byte |= 1 << (7 - col);
    }
    out[row] = byte;
  }
  return out;
}

/**
 * Computes the dHash from a source canvas. The canvas can be any size — we
 * resample to 9x8 grayscale internally. Returns an 8-byte hash whose bit
 * layout matches the backend.
 */
export function dHashFromCanvas(source: HTMLCanvasElement): Uint8Array {
  // drawImage into a 9x8 canvas asks the browser's image scaler to do the
  // hard work. imageSmoothingQuality:'high' nudges the browser toward a
  // higher-order resampler where supported (Chromium/Firefox).
  const target = document.createElement('canvas');
  target.width = 9;
  target.height = 8;
  const ctx = target.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D context for dHash');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  return dHashFromRgba9x8(data);
}

/** Hex-encodes a hash for the API. 16 chars for a 64-bit hash. */
export function hashToHex(hash: Uint8Array): string {
  let s = '';
  for (const b of hash) s += b.toString(16).padStart(2, '0');
  return s;
}
