import { describe, expect, it } from 'vitest';
import { snapToGrid } from './snap-grid';

// A 1000×600 box with 100×140 cards: the x span is 900px, the y span 460px,
// and the pitch is 50px across, 70px down.
const g = { width: 1000, height: 600, cardW: 100, cardH: 140 };

describe('snapToGrid', () => {
  it('rounds a drop to the nearest half-card line', () => {
    // 0.1 × 900 = 90px → 100px; 0.1 × 460 = 46px → 70px.
    const { x, y } = snapToGrid(0.1, 0.1, g);
    expect(x * 900).toBeCloseTo(100);
    expect(y * 460).toBeCloseTo(70);
  });

  it('puts two cards dropped near each other on the same line', () => {
    const a = snapToGrid(0.21, 0.3, g);
    const b = snapToGrid(0.23, 0.31, g);
    expect(a).toEqual(b);
  });

  it('never pushes a card off the table', () => {
    expect(snapToGrid(0.999, 0.999, g)).toEqual({ x: 1, y: 1 });
    expect(snapToGrid(0.001, 0, g)).toEqual({ x: 0, y: 0 });
  });

  it('leaves the drop alone when the box has not been measured', () => {
    expect(snapToGrid(0.37, 0.42, { width: 0, height: 0, cardW: 100, cardH: 140 })).toEqual({
      x: 0.37,
      y: 0.42,
    });
  });
});
