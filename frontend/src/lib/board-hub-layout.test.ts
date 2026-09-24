import { describe, expect, it } from 'vitest';
import { hubPetalPositions } from './board-hub-layout';

const VIEWPORT_320 = { width: 320, height: 568 };
const PETAL = { width: 128, height: 48 };

function inBounds(p: { x: number; y: number }, viewport: { width: number; height: number }) {
  const halfW = PETAL.width / 2;
  const halfH = PETAL.height / 2;
  expect(p.x).toBeGreaterThanOrEqual(8 + halfW - 0.001);
  expect(p.x).toBeLessThanOrEqual(viewport.width - 8 - halfW + 0.001);
  expect(p.y).toBeGreaterThanOrEqual(8 + halfH - 0.001);
  expect(p.y).toBeLessThanOrEqual(viewport.height - 8 - halfH + 0.001);
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
});
