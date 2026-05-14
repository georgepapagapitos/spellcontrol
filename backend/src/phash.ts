/**
 * Difference-hash (dHash) primitives used by the card scanner.
 *
 * Why dHash, not DCT-based pHash:
 *   - Deterministic across runtimes — no DCT-library mismatch between Node
 *     (sharp) and the browser (canvas). The algorithm is just: resize to 9x8
 *     grayscale, then for each row emit 8 difference bits.
 *   - 64-bit output → 8-byte hash. Hamming distance over 90k entries is
 *     ~5 ms in Node with a linear scan, so no fancy index is needed.
 *   - Robust to brightness/contrast shifts (only the SIGN of pixel diffs
 *     matters) — well-matched to "phone photo of a card" vs Scryfall's clean
 *     art_crop reference.
 *
 * Same algorithm runs on the client (browser canvas → hash) and the server
 * ingest (sharp → hash). The runtime endpoint never hashes images itself —
 * it just receives a hash from the client and does nearest-neighbour search.
 */

/** Hash output size in bytes (64 bits = 9x8 image, 8 diff bits per row). */
export const HASH_BYTES = 8;

/**
 * Computes the dHash from an already-resized 9x8 grayscale luminance buffer.
 * Both backend (post-sharp) and frontend (post-canvas) collapse their pipelines
 * to this final step so the bit layout is byte-for-byte identical.
 *
 * Input: 72 grayscale values (0–255), row-major, 9 columns × 8 rows.
 * Output: 8-byte Uint8Array, row-major, MSB-first within each byte.
 */
export function dHashFromLuminance(luma: ArrayLike<number>): Uint8Array {
  if (luma.length !== 9 * 8) {
    throw new Error(`dHashFromLuminance expected 72 samples, got ${luma.length}`);
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

/** Hex-encodes a hash for transport. 16 chars for a 64-bit hash. */
export function hashToHex(hash: Uint8Array): string {
  let s = '';
  for (const b of hash) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Parses a hex hash from the client. Returns null if malformed. */
export function hashFromHex(hex: string): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length !== HASH_BYTES * 2) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(HASH_BYTES);
  for (let i = 0; i < HASH_BYTES; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Hamming distance between two equal-length hashes. Lower = more similar.
 * For 64-bit dHash on card art, distances ≤ 12 are confident matches in
 * practice; 13–18 are usually correct but worth flagging; above that the
 * caller should treat the result as "no match".
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error('hammingDistance: length mismatch');
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = a[i] ^ b[i];
    // SWAR popcount for a single byte — fast and dependency-free.
    xor = xor - ((xor >> 1) & 0x55);
    xor = (xor & 0x33) + ((xor >> 2) & 0x33);
    distance += (xor + (xor >> 4)) & 0x0f;
  }
  return distance;
}

/** Convenience for ingest scripts: standard sRGB luminance. */
export function rgbToLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
