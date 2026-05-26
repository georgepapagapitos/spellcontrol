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

// Golden hash: captured from the reference implementation against the
// gradient fixture above. If the algorithm ever has to change intentionally,
// regenerate from this same fixture and update both the backend and frontend
// tests in the same commit — drift between the two implementations is what
// this golden is designed to surface.
const GRADIENT_GOLDEN = 13323319483396658241n;

describe('computePHash', () => {
  it('rejects buffers of the wrong size', () => {
    expect(() => computePHash(new Uint8Array(100))).toThrow(/32×32/);
  });

  it('matches the golden hash for a canonical gradient fixture', () => {
    const h = computePHash(gradient32());
    expect(h).toBe(GRADIENT_GOLDEN);
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
