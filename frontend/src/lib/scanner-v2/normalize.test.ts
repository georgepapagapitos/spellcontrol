import { describe, it, expect } from 'vitest';
import { claheGrayscale } from './normalize';

describe('claheGrayscale', () => {
  it('returns a buffer of the same length', () => {
    const w = 16;
    const h = 16;
    const input = new Uint8Array(w * h).map((_, i) => i % 256);
    const out = claheGrayscale(input, w, h);
    expect(out.length).toBe(input.length);
  });

  it('produces a flat output for a flat input', () => {
    // CLAHE's clip-and-redistribute step does shift the output value of a
    // constant image (the redistributed mass changes the CDF), but every
    // output pixel must still be the SAME value — no tile-boundary
    // artifacts on a degenerate input.
    const w = 32;
    const h = 32;
    const input = new Uint8Array(w * h).fill(128);
    const out = claheGrayscale(input, w, h);
    const first = out[0];
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBe(first);
    }
  });

  it('expands a narrow-range image toward the full 0..255 range', () => {
    // Image with all pixels clustered in [100, 130]; CLAHE should stretch
    // them to cover more of the dynamic range.
    const w = 32;
    const h = 32;
    const input = new Uint8Array(w * h);
    for (let i = 0; i < input.length; i++) {
      input[i] = 100 + (i % 31);
    }
    const out = claheGrayscale(input, w, h);
    let lo = 255;
    let hi = 0;
    for (const v of out) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    expect(hi - lo).toBeGreaterThan(60); // input span was 30; expect more.
  });

  it('respects tileGrid option', () => {
    const w = 32;
    const h = 32;
    const input = new Uint8Array(w * h).map((_, i) => (i * 7) % 256);
    // Different tileGrid values should produce different outputs on a
    // non-trivial input (otherwise the parameter would be inert).
    const a = claheGrayscale(input, w, h, { tileGrid: 4 });
    const b = claheGrayscale(input, w, h, { tileGrid: 8 });
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('produces values that stay in [0, 255]', () => {
    const w = 24;
    const h = 24;
    const input = new Uint8Array(w * h).map((_, i) => (i * 13) % 256);
    const out = claheGrayscale(input, w, h, { clipLimit: 4 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
