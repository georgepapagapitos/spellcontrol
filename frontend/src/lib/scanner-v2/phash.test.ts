import { describe, it, expect } from 'vitest';
import { computePHash, hammingDistance } from './phash';

// Same fixture + golden hash as backend/src/scanner/phash.test.ts —
// these two implementations are drift-checked against each other via this
// shared value. If you change one side, regenerate this constant from a
// fresh run of either suite and update both tests together.
function gradient32(): Uint8Array {
  const out = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      out[y * 32 + x] = Math.min(255, (x + y) * 4);
    }
  }
  return out;
}

const GRADIENT_GOLDEN = 13323319483396658241n;

describe('computePHash (frontend twin)', () => {
  it('matches the shared backend/frontend golden hash', () => {
    expect(computePHash(gradient32())).toBe(GRADIENT_GOLDEN);
  });

  it('rejects buffers of the wrong size', () => {
    expect(() => computePHash(new Uint8Array(100))).toThrow(/32×32/);
  });

  it('is stable across repeated calls', () => {
    const buf = gradient32();
    expect(computePHash(buf)).toBe(computePHash(buf));
  });

  it('changes when image content changes', () => {
    const a = gradient32();
    const b = gradient32();
    for (let y = 14; y < 18; y++) {
      for (let x = 14; x < 18; x++) b[y * 32 + x] = 0;
    }
    expect(computePHash(a)).not.toBe(computePHash(b));
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
  });
  it('returns 64 for fully opposite hashes', () => {
    expect(hammingDistance(0n, 0xffffffffffffffffn)).toBe(64);
  });
  it('counts only the differing bits', () => {
    expect(hammingDistance(0b1010n, 0b1100n)).toBe(2);
  });
});
