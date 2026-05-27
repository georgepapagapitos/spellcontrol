// 64-bit DCT-based perceptual hash (pHash).
//
// Algorithm (Zauner 2010, the de-facto standard):
//   1. Caller supplies a 32×32 grayscale image (one byte per pixel, row-major).
//      Pixel acquisition (decode + resize + grayscale) is platform-specific
//      and lives outside this module — backend uses sharp, frontend uses a
//      canvas. Both feed the same 1024-byte array in here.
//   2. 2D DCT-II → 32×32 frequency-domain matrix.
//   3. Take the top-left 8×8 block of DCT coefficients (low frequencies).
//   4. Compute the median of those 64 coefficients excluding the DC term
//      ([0,0]) so a constant brightness offset doesn't dominate.
//   5. For each of the 64 cells, emit bit 1 if coefficient > median else 0.
//
// The algorithm must stay byte-identical to the frontend twin at
// frontend/src/lib/scanner-v2/phash.ts — both copies are exercised against
// the same golden vector in their unit tests so drift is caught at CI.

export const PHASH_INPUT_SIZE = 32;
export const PHASH_BLOCK = 8;

export function computePHash(gray32x32: Uint8Array | Uint8ClampedArray): bigint {
  if (gray32x32.length !== PHASH_INPUT_SIZE * PHASH_INPUT_SIZE) {
    throw new Error(
      `pHash expects a ${PHASH_INPUT_SIZE}×${PHASH_INPUT_SIZE} grayscale buffer, got ${gray32x32.length} bytes`
    );
  }

  const dct = dct2dSquare(gray32x32, PHASH_INPUT_SIZE);

  // Extract the top-left 8×8 low-frequency block.
  const lowFreq = new Float64Array(PHASH_BLOCK * PHASH_BLOCK);
  for (let y = 0; y < PHASH_BLOCK; y++) {
    for (let x = 0; x < PHASH_BLOCK; x++) {
      lowFreq[y * PHASH_BLOCK + x] = dct[y * PHASH_INPUT_SIZE + x];
    }
  }

  // Median of the 63 non-DC values. Sorting allocates a copy so lowFreq stays
  // in original order for the bit comparison below.
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

// Separable 2D DCT-II for square N×N input. O(N³) — fine for N=32.
// Coefficients omit the standard normalization scalar (2/N) because the
// median-threshold step is scale-invariant; this saves one multiply per cell.
function dct2dSquare(input: Uint8Array | Uint8ClampedArray, n: number): Float64Array {
  // Precompute the cosine table — same lookups repeated O(N) times per row.
  const cos = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    for (let x = 0; x < n; x++) {
      cos[k * n + x] = Math.cos(((2 * x + 1) * k * Math.PI) / (2 * n));
    }
  }
  const sqrt1_2 = Math.SQRT1_2;

  // Pass 1: 1D DCT over rows → intermediate[y, u].
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

  // Pass 2: 1D DCT over columns of intermediate → result[v, u].
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

/** Pack a 64-bit hash into a little-endian 8-byte Buffer for the on-disk format. */
export function packHashLE(hash: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(hash, 0);
  return buf;
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
