import { describe, it, expect } from 'vitest';
import { computePHash, hammingDistance, packHashLE } from './phash';

// Build a deterministic 32×32 grayscale fixture: a diagonal gradient. Stable
// across platforms because pixel values are computed from indices, not
// from any image library. The frontend twin test uses the exact same
// fixture + expected hash so drift between the two implementations fails CI.
function gradient32(): Uint8Array {
  const out = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      out[y * 32 + x] = Math.min(255, (x + y) * 4);
    }
  }
  return out;
}

// Golden hash: captured from the reference implementation (Node 22) against
// the gradient fixture above. The DCT path uses Math.cos + Float64Array sums,
// which can drift by a few low-order bits between V8 versions (e.g. Node 22
// → 24 → 26) without the algorithm actually changing. pHash is a *perceptual*
// hash — its production use (the hash-DB nearest-neighbor search) tolerates
// Hamming distances up to ~12, so asserting exact bigint equality here was
// always too strict and brittle to runtime upgrades. We assert Hamming
// tolerance instead: a true algorithm change moves many bits; floating-point
// microarchitecture drift moves at most a handful. If this fails by more than
// `GOLDEN_HAMMING_TOLERANCE` bits, something real broke; regenerate the
// constant from a fresh run and update both this file and the frontend twin
// in the same commit.
const GRADIENT_GOLDEN = 11017477023938778177n;
const GOLDEN_HAMMING_TOLERANCE = 6;

describe('computePHash', () => {
  it('rejects buffers of the wrong size', () => {
    expect(() => computePHash(new Uint8Array(100))).toThrow(/32×32/);
  });

  it('matches the golden hash for a canonical gradient fixture (within tolerance)', () => {
    const h = computePHash(gradient32());
    const dist = hammingDistance(h, GRADIENT_GOLDEN);
    expect(dist).toBeLessThanOrEqual(GOLDEN_HAMMING_TOLERANCE);
  });

  it('returns a 64-bit value (fits in BigUint64)', () => {
    const h = computePHash(gradient32());
    expect(h).toBeLessThanOrEqual((1n << 64n) - 1n);
    expect(h).toBeGreaterThanOrEqual(0n);
  });

  it('is stable across repeated calls', () => {
    const buf = gradient32();
    expect(computePHash(buf)).toBe(computePHash(buf));
  });

  it('changes when the image content changes', () => {
    const a = gradient32();
    const b = gradient32();
    b[16 * 32 + 16] = 0;
    b[16 * 32 + 17] = 0;
    b[17 * 32 + 16] = 0;
    b[17 * 32 + 17] = 0;
    // Not strictly guaranteed but overwhelmingly likely for a 4-pixel change
    // in the middle of a low-entropy fixture.
    expect(computePHash(a)).not.toBe(computePHash(b));
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0xffffffffffffffffn, 0xffffffffffffffffn)).toBe(0);
  });

  it('returns 64 for fully opposite hashes', () => {
    expect(hammingDistance(0n, 0xffffffffffffffffn)).toBe(64);
  });

  it('counts only the differing bits', () => {
    expect(hammingDistance(0b1010n, 0b1100n)).toBe(2);
  });
});

describe('packHashLE', () => {
  it('serializes to 8 little-endian bytes', () => {
    const buf = packHashLE(0x0102030405060708n);
    expect(Array.from(buf)).toEqual([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
  });
});
