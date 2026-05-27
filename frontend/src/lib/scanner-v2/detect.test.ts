import { describe, it, expect } from 'vitest';
import { orderQuadCorners, type Point } from './detect';

describe('orderQuadCorners', () => {
  // Build a quadrilateral and shuffle its corners to verify the sorter
  // recovers TL, TR, BR, BL regardless of input order.
  const tl: Point = { x: 10, y: 20 };
  const tr: Point = { x: 200, y: 25 };
  const br: Point = { x: 210, y: 320 };
  const bl: Point = { x: 5, y: 310 };

  it('orders an axis-aligned rectangle correctly', () => {
    const out = orderQuadCorners([tr, br, bl, tl]);
    expect(out).toEqual([tl, tr, br, bl]);
  });

  it('handles a rotated/skewed quad', () => {
    // Approximate a card photographed at a slight tilt; corners are still
    // distinguishable by (x+y, y-x) extremes.
    const skewedTL: Point = { x: 50, y: 30 };
    const skewedTR: Point = { x: 240, y: 80 };
    const skewedBR: Point = { x: 220, y: 360 };
    const skewedBL: Point = { x: 25, y: 320 };
    const out = orderQuadCorners([skewedBR, skewedTL, skewedBL, skewedTR]);
    expect(out).toEqual([skewedTL, skewedTR, skewedBR, skewedBL]);
  });

  it('throws if not given 4 points', () => {
    expect(() => orderQuadCorners([tl, tr, br])).toThrow();
  });
});
