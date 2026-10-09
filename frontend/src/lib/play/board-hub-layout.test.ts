import { describe, expect, it } from 'vitest';
import { hubPetalPositions } from './board-hub-layout';

const VIEWPORT_320 = { width: 320, height: 568 };
const VIEWPORT_390 = { width: 390, height: 844 };
// A ring key's box (`.board-hub-key`), see board-hub-layout.ts's own
// DEFAULT_PETAL comment. Kept in sync here rather than imported so a change to
// one is a deliberate change to both.
const PETAL = { width: 72, height: 64 };
// The compact key a board under 359px wide gets (BoardHubMenu's HUB_KEY_COMPACT).
const COMPACT = { width: 66, height: 60 };

function inBounds(
  p: { x: number; y: number },
  viewport: { width: number; height: number },
  key = PETAL
) {
  const halfW = key.width / 2;
  const halfH = key.height / 2;
  expect(p.x).toBeGreaterThanOrEqual(8 + halfW - 0.001);
  expect(p.x).toBeLessThanOrEqual(viewport.width - 8 - halfW + 0.001);
  expect(p.y).toBeGreaterThanOrEqual(8 + halfH - 0.001);
  expect(p.y).toBeLessThanOrEqual(viewport.height - 8 - halfH + 0.001);
}

function rectFor(p: { x: number; y: number }, key = PETAL) {
  return {
    left: p.x - key.width / 2,
    right: p.x + key.width / 2,
    top: p.y - key.height / 2,
    bottom: p.y + key.height / 2,
  };
}

function rectsOverlap(a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function expectNoOverlap(points: { x: number; y: number }[], key = PETAL) {
  const rects = points.map((p) => rectFor(p, key));
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
    expect(hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 6)).toHaveLength(6);
    expect(hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 0)).toHaveLength(0);
  });

  it('keeps every petal on screen at 320px wide, hub at center', () => {
    const points = hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 6);
    for (const p of points) inBounds(p, VIEWPORT_320);
  });

  it('keeps every petal on screen when the hub sits in a corner', () => {
    for (const hub of [
      { x: 24, y: 24 },
      { x: 296, y: 24 },
      { x: 24, y: 544 },
      { x: 296, y: 544 },
    ]) {
      const points = hubPetalPositions(hub, VIEWPORT_320, 6);
      for (const p of points) inBounds(p, VIEWPORT_320);
    }
  });

  it('keeps every petal on screen at the hub sitting exactly at viewport center', () => {
    const points = hubPetalPositions(
      { x: VIEWPORT_320.width / 2, y: VIEWPORT_320.height / 2 },
      VIEWPORT_320,
      5
    );
    for (const p of points) inBounds(p, VIEWPORT_320);
  });

  it('spreads petals apart rather than stacking them on one point', () => {
    const points = hubPetalPositions({ x: 160, y: 284 }, VIEWPORT_320, 6);
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
    const points = hubPetalPositions(hub, VIEWPORT_320, 6);
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
    // (25%); this checks that and dead center, at both viewports.
    for (const viewport of [VIEWPORT_320, VIEWPORT_390]) {
      it(`hub at center, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });

      it(`hub near the top seam (row 1 of 4), ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height * 0.25 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });

      it(`hub near the bottom seam (row 3 of 4), ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width / 2, y: viewport.height * 0.75 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });

      // The board never actually offsets the hub horizontally today (`cols`
      // is fixed at 2), but the function itself makes no such assumption —
      // these guard the fallback fan against a future non-centred layout.
      it(`hub near the left edge, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.2, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });

      it(`hub near the right edge, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.8, y: viewport.height / 2 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });

      // A hub offset on BOTH axes at once (a true viewport corner) cannot
      // happen on this app's fixed 2-column board, and six keys can't sit
      // corner-close without overlapping at any shared radius. This is a
      // diagonal offset the ring still clears: a stand-in for "as corner as
      // it gets", not a cherry-picked near-centre point.
      it(`hub near a corner, as tight as this petal size allows, ${viewport.width}x${viewport.height}`, () => {
        const hub = { x: viewport.width * 0.47, y: viewport.height * 0.47 };
        expectNoOverlap(hubPetalPositions(hub, viewport, 6));
      });
    }

    // F8: 8p-2v6 @ 320x568 measured 1,264px² of pair overlap with the old
    // pill petals (`.claude/tools/life-board-probe.mjs … HUB=1`). The hub sits
    // at row 1 of 4, but the real `.game-board-grid` at this viewport is only
    // 304x482 (the clock strip and safe-area padding eat the rest), not the
    // full viewport the fraction-based cases above assume. Coordinates
    // measured from a real headless-Edge render. A grid this narrow gets the
    // compact key (BoardHubMenu: under 359px wide), which is what fits here:
    // the full key's circle would need 83px of room above the hub, and it
    // has 80.
    it('hub high on a short board (8p-2v6 @ 320x568, the real measured position)', () => {
      const hub = { x: 152, y: 120.5 };
      const viewport = { width: 304, height: 482 };
      const points = hubPetalPositions(hub, viewport, 6, { petal: COMPACT, radius: 98 });
      expectNoOverlap(points, COMPACT);
      for (const p of points) inBounds(p, viewport, COMPACT);
    });
  });
});
