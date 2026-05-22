// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAB_CORNER,
  FAB_CORNERS,
  FAN_RADIUS_PX,
  fanItemOffset,
  loadFabCorner,
  nearestCorner,
  saveFabCorner,
  type FabCorner,
} from './nav-fab-geometry';

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

describe('nearestCorner', () => {
  // 200×100 container; midlines at x=100, y=50.
  it.each<[number, number, FabCorner]>([
    [10, 10, 'tl'],
    [190, 10, 'tr'],
    [10, 90, 'bl'],
    [190, 90, 'br'],
  ])('point (%i,%i) snaps to %s', (x, y, corner) => {
    expect(nearestCorner(x, y, 200, 100)).toBe(corner);
  });

  it('treats the exact midline as the bottom/right half', () => {
    expect(nearestCorner(100, 50, 200, 100)).toBe('br');
  });
});

describe('fanItemOffset', () => {
  it('opens the first item straight along the vertical edge', () => {
    // index 0 → angle 0 → no horizontal component, full vertical reach.
    const off = fanItemOffset('br', 0, 4);
    expect(off.x).toBeCloseTo(0);
    expect(off.y).toBeCloseTo(-FAN_RADIUS_PX);
  });

  it('opens the last item straight along the horizontal edge', () => {
    const off = fanItemOffset('br', 3, 4);
    expect(off.x).toBeCloseTo(-FAN_RADIUS_PX);
    expect(off.y).toBeCloseTo(0);
  });

  it('always fans into the screen for every corner', () => {
    const mid = (corner: FabCorner) => fanItemOffset(corner, 1, 4);
    // Bottom corners fan upward (y<0), top corners downward (y>0).
    expect(mid('br').y).toBeLessThan(0);
    expect(mid('bl').y).toBeLessThan(0);
    expect(mid('tr').y).toBeGreaterThan(0);
    expect(mid('tl').y).toBeGreaterThan(0);
    // Right corners fan leftward (x<0), left corners rightward (x>0).
    expect(mid('br').x).toBeLessThan(0);
    expect(mid('tr').x).toBeLessThan(0);
    expect(mid('bl').x).toBeGreaterThan(0);
    expect(mid('tl').x).toBeGreaterThan(0);
  });

  it('centres a single item in the quadrant', () => {
    const off = fanItemOffset('br', 0, 1, 100);
    // angle 45° → equal x/y components.
    expect(Math.abs(off.x)).toBeCloseTo(Math.abs(off.y));
  });

  it('honours a custom radius', () => {
    const off = fanItemOffset('tl', 0, 4, 200);
    expect(off.y).toBeCloseTo(200);
  });
});

describe('corner persistence', () => {
  it('round-trips a saved corner', () => {
    saveFabCorner('tl');
    expect(loadFabCorner()).toBe('tl');
  });

  it('falls back to the default when nothing is stored', () => {
    expect(loadFabCorner()).toBe(DEFAULT_FAB_CORNER);
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('sc:nav-fab-corner', 'middle');
    expect(loadFabCorner()).toBe(DEFAULT_FAB_CORNER);
  });

  it('survives storage throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => saveFabCorner('tr')).not.toThrow();
    expect(loadFabCorner()).toBe(DEFAULT_FAB_CORNER);
  });

  it('exposes exactly four corners', () => {
    expect([...FAB_CORNERS].sort()).toEqual(['bl', 'br', 'tl', 'tr']);
  });
});
