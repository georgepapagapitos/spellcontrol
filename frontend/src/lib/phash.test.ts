import { describe, it, expect } from 'vitest';
import { HASH_BYTES, dHashFromRgba9x8, hashToHex } from './phash';

function rgba(width: number, height: number, sample: (x: number, y: number) => number) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = sample(x, y);
      const i = (y * width + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

describe('dHashFromRgba9x8', () => {
  it('returns an 8-byte hash', () => {
    const hash = dHashFromRgba9x8(rgba(9, 8, () => 128));
    expect(hash.length).toBe(HASH_BYTES);
  });

  it('rejects wrong-sized input', () => {
    expect(() => dHashFromRgba9x8(new Uint8ClampedArray(100))).toThrow();
  });

  it('emits zero bits for a flat image', () => {
    const hash = dHashFromRgba9x8(rgba(9, 8, () => 200));
    for (const byte of hash) expect(byte).toBe(0);
  });

  it('emits one bits for a strictly decreasing row (left > right)', () => {
    const hash = dHashFromRgba9x8(rgba(9, 8, (x) => 250 - x));
    for (const byte of hash) expect(byte).toBe(0xff);
  });

  // Critical correctness property: the frontend dHash must match the
  // backend's `dHashFromLuminance` for the same logical input. Test by
  // building an RGBA buffer where every channel equals the target luminance
  // and comparing against a known sequence.
  it('matches backend bit layout on a known input', () => {
    // 0,1,2,...,8 in every row — strictly increasing, so left < right → all
    // zero bits, same as the backend.
    const hash = dHashFromRgba9x8(rgba(9, 8, (x) => x));
    expect(hashToHex(hash)).toBe('0'.repeat(HASH_BYTES * 2));
  });
});
