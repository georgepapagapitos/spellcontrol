import { describe, it, expect } from 'vitest';
import { binarize, grayscaleInPlace, ocrCandidates, otsuThreshold } from './scanner-preprocess';

/**
 * Build an RGBA buffer with two intensity populations: `frac` of the pixels
 * at `dark`, the rest at `light`. Used to assert Otsu picks a threshold
 * between the two — i.e. that the algorithm separates the populations.
 */
function bimodalRgba(count: number, frac: number, dark: number, light: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(count * 4);
  const cutoff = Math.floor(count * frac);
  for (let i = 0; i < count; i++) {
    const v = i < cutoff ? dark : light;
    const k = i * 4;
    rgba[k] = rgba[k + 1] = rgba[k + 2] = v;
    rgba[k + 3] = 255;
  }
  return rgba;
}

describe('otsuThreshold', () => {
  it('picks a threshold that separates two well-separated populations', () => {
    // Standard convention (cv.threshold default): pixels with intensity
    // <= threshold are background; > threshold are foreground. So a
    // bimodal {40, 200} image's optimal threshold is anywhere in
    // [40, 199]; our implementation picks the left boundary and that's
    // a valid separator.
    const rgba = bimodalRgba(1000, 0.4, 40, 200);
    const t = otsuThreshold(rgba);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(200);
  });

  it('handles a heavily skewed bright-background image', () => {
    // 85% paper, 15% ink — the realistic title-strip distribution.
    const rgba = bimodalRgba(1000, 0.15, 30, 220);
    const t = otsuThreshold(rgba);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it('returns a degenerate value for a uniform image without crashing', () => {
    const rgba = new Uint8ClampedArray(400);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
    // Otsu has no separation to find on a flat image — only the
    // *behaviour* (no crash, value in range) matters here.
    const t = otsuThreshold(rgba);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });
});

describe('grayscaleInPlace', () => {
  it('writes R=G=B and returns the mean luminance', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const mean = grayscaleInPlace(rgba);
    expect(rgba[0]).toBe(rgba[1]);
    expect(rgba[1]).toBe(rgba[2]);
    expect(rgba[4]).toBe(rgba[5]);
    expect(rgba[5]).toBe(rgba[6]);
    expect(mean).toBeGreaterThan(0);
    expect(mean).toBeLessThan(255);
  });
});

describe('binarize', () => {
  it('produces a pure black-and-white image (dark-on-light input)', () => {
    const rgba = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
    binarize(rgba, 100, false);
    // Dark pixel (≤ threshold) → stays dark (ink).
    expect(rgba[0]).toBe(0);
    // Bright pixel (> threshold) → stays bright (paper).
    expect(rgba[4]).toBe(255);
  });

  it('flips polarity when the source is light-text-on-dark', () => {
    const rgba = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
    binarize(rgba, 100, true);
    // With invert, the originally-dark pixel becomes white (it was the
    // background of a light-on-dark image; now flipped to OCR-friendly
    // orientation).
    expect(rgba[0]).toBe(255);
    expect(rgba[4]).toBe(0);
  });
});

describe('ocrCandidates', () => {
  it('returns at least the cleaned input as the first candidate', () => {
    const c = ocrCandidates('  Evolving   Wilds  ');
    expect(c[0]).toBe('Evolving Wilds');
  });

  it('generates an alternate for the rn↔m confusion', () => {
    const c = ocrCandidates('Pyrornantic Pilgrim');
    expect(c).toContain('Pyromantic Pilgrim');
  });

  it('generates an alternate for the cl↔d confusion', () => {
    const c = ocrCandidates('Lighclning Bolt');
    expect(c).toContain('Lighdning Bolt');
  });

  it('falls back to the first word when the OCR run picked up extra text', () => {
    const c = ocrCandidates('Sol Ring Artifact Add one colorless');
    expect(c).toContain('Sol Ring');
    expect(c).toContain('Sol');
  });

  it('returns an empty list for unrecoverable garbage', () => {
    expect(ocrCandidates('')).toEqual([]);
    expect(ocrCandidates('   ')).toEqual([]);
    // After stripping non-title chars only a single letter is left — too
    // short to be worth trying.
    expect(ocrCandidates('@')).toEqual([]);
  });

  it('caps the candidate list to keep matcher latency bounded', () => {
    const c = ocrCandidates('vvrn cl 0 1 | 5 8 vv test variants');
    expect(c.length).toBeLessThanOrEqual(8); // 6 substitutions + 2 prefix fallbacks
  });
});
