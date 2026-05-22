import { describe, expect, it } from 'vitest';
import { FAN_RADIUS_PX, fanItemOffset } from './nav-fab-geometry';

describe('fanItemOffset', () => {
  it('opens the first item straight up', () => {
    // index 0 → angle 0 → no horizontal component, full upward reach.
    const off = fanItemOffset(0, 4);
    expect(off.x).toBeCloseTo(0);
    expect(off.y).toBeCloseTo(-FAN_RADIUS_PX);
  });

  it('opens the last item straight left', () => {
    const off = fanItemOffset(3, 4);
    expect(off.x).toBeCloseTo(-FAN_RADIUS_PX);
    expect(off.y).toBeCloseTo(0);
  });

  it('always fans up-and-left into the screen', () => {
    for (let i = 0; i < 4; i++) {
      const off = fanItemOffset(i, 4);
      expect(off.x).toBeLessThanOrEqual(0);
      expect(off.y).toBeLessThanOrEqual(0);
    }
  });

  it('spreads middle items diagonally', () => {
    const off = fanItemOffset(1, 4);
    expect(off.x).toBeLessThan(0);
    expect(off.y).toBeLessThan(0);
  });

  it('centres a single item in the quadrant', () => {
    const off = fanItemOffset(0, 1, 100);
    // angle 45° → equal x/y magnitudes.
    expect(Math.abs(off.x)).toBeCloseTo(Math.abs(off.y));
  });

  it('honours a custom radius', () => {
    const off = fanItemOffset(0, 4, 200);
    expect(off.y).toBeCloseTo(-200);
  });
});
