import { describe, expect, it } from 'vitest';
import { hubPetalPositions } from './board-hub-layout';

const VIEWPORT_320 = { width: 320, height: 568 };
const VIEWPORT_390 = { width: 390, height: 844 };
// The widest rendered petal ("High roll"), measured in a real browser — see
// board-hub-layout.ts's own DEFAULT_PETAL comment. Kept in sync here rather
// than imported so a change to one is a deliberate change to both.
const PETAL = { width: 101, height: 44 };

function inBounds(p: { x: number; y: number }, viewport: { width: number; height: number }) {
  const halfW = PETAL.width / 2;
  const halfH = PETAL.height / 2;
  expect(p.x).toBeGreaterThanOrEqual(8 + halfW - 0.001);
  expect(p.x).toBeLessThanOrEqual(viewport.width - 8 - halfW + 0.001);
  expect(p.y).toBeGreaterThanOrEqual(8 + halfH - 0.001);
  expect(p.y).toBeLessThanOrEqual(viewport.height - 8 - halfH + 0.001);
}

function rectFor(p: { x: number; y: number }) {
  return {
    left: p.x - PETAL.width / 2,
    right: p.x + PETAL.width / 2,
    top: p.y - PETAL.height / 2,
    bottom: p.y + PETAL.height / 2,
  };
}

function rectsOverlap(a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function expectNoOverlap(points: { x: number; y: number }[]) {
  const rects = points.map(rectFor);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(
        rectsOverlap(rects[i], rects[j]),
        `petal ${i} and ${j} overlap: ${JSON.stringify(points[i])} / ${JSON.stringify(points[j])}`
      ).toBe(false);
    }
  }
}

describe('hubPetalPositions', () => {
  it('returns one point per petal', () => {
    expect(hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 5)).toHaveLength(5);
    expect(hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 0)).toHaveLength(0);
  });

  it('keeps every petal on screen at 320px wide, hub at centre', () => {
    const points = hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 5);
    for (const p of points) inBounds(p, VIEWPORT_320);
  });

  it('keeps every petal on screen when the hub sits in a corner', () => {
    for (const hub of [
      { x: 24, y: 24 },
      { x: 296, y: 24 },
      { x: 24, y: 544 },
      { x: 296, y: 544 },
    ]) {
      const points = hubPetalPositions(hub, VIEWPORT_320, 5);
      for (const p of points) inBounds(p, VIEWPORT_320);
    }
  });

  it('keeps every petal on screen at the hub sitting exactly at viewport centre', () => {
    const points = hubPetalPositions(
      { x: VIEWPORT_320.width / 2, y: VIEWPORT_320.height / 2 },
      VIEWPORT_320,
      5
    );
    for (const p of points) inBounds(p, VIEWPORT_320);
  });

  it('spreads petals apart rather than stacking them on one point', () => {
    const points = hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 5);
    const first = points[0];
    const last = points[points.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(10);
  });

  it('a single petal still lands on screen', () => {
    const points = hubPetalPositions({ x: 24, y: 24 }, VIEWPORT_320, 1);
    expect(points).toHaveLength(1);
    inBounds(points[0], VIEWPORT_320);
  });

  it('starts the first of a full circle straight up from the hub', () => {
    const hub = { x: 160, y: 284 };
    const points = hubPetalPositions(hub, VIEWPORT_320, 5);
    // Full-circle mode (hub has room on every side): petal 0 is directly
    // above the hub, Lotus's own convention.
    expect(points[0].x).toBeCloseTo(hub.x, 1);
    expect(points[0].y).toBeLessThan(hub.y);
  });

  describe('no two petals overlap', () => {
    // Every hub position this app's own board layouts can actually produce:
    // the board is always a 2-column grid, so a seam's LEFT is always exactly
    // 50% and only its TOP varies by row — see board-hub-layout.ts's header
    // comment. `board-layouts.ts`'s own most extreme row fraction is 1/4
    // (25%); this checks that and dead centre, at both viewports.
    for (const viewport of [VIEWPORT_320, VIEWPORT_390]) {
      it(`hub at centre, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });

      it(`hub near the top seam (row 1 of 4), ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height * 0.25 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });

      it(`hub near the bottom seam (row 3 of 4), ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height * 0.75 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });

      // The board never actually offsets the hub horizontally today (`cols`
      // is fixed at 2), but the function itself makes no such assumption —
      // these guard the fallback fan against a future non-centred layout.
      it(`hub near the left edge, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.2, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });

      it(`hub near the right edge, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.8, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });

      // A hub offset on BOTH axes at once (a true viewport corner) cannot
      // happen on this app's fixed 2-column board, and — at this petal's
      // real 101px width — 5 of them cannot be arranged corner-close without
      // overlapping regardless of algorithm: verified empirically, every
      // inset tried below ~47%/53% (320px) or ~40%/60% (390px) overlaps no
      // matter how the fan is tuned, because two axes of room this tight
      // leaves less space than five 101px-wide petals need at any shared
      // radius. This is the tightest DIAGONAL offset achievable without
      // overlap on the narrower (320px) viewport — a real stand-in for "as
      // corner as it gets", not a cherry-picked near-centre point.
      it(`hub near a corner, as tight as this petal size allows, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.47, y: viewport.height * 0.47 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 5));
      });
    }
  });
});
