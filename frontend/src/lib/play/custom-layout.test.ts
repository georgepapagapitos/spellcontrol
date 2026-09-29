import { describe, it, expect } from 'vitest';
import {
  applyPlacement,
  deriveSeam,
  occupancyOf,
  rangeFree,
  rangeFreeRows,
  type Placement,
} from './custom-layout';

const seat = (
  col: 1 | 2,
  row: number,
  rot: 0 | 90 | 180 | 270 = 0,
  colSpan: 1 | 2 = 1,
  rowSpan: 1 | 2 = 1
): Placement => ({ col, row, colSpan, rowSpan, rot });

describe('occupancyOf', () => {
  it('maps spanned cells to the owning seat index', () => {
    const occ = occupancyOf([seat(1, 1, 0, 2, 1), null, seat(1, 2, 0, 1, 2)]);
    expect(occ.get('1,1')).toBe(0);
    expect(occ.get('2,1')).toBe(0); // colSpan 2
    expect(occ.get('1,2')).toBe(2);
    expect(occ.get('1,3')).toBe(2); // rowSpan 2
    expect(occ.has('2,2')).toBe(false);
  });

  it('ignores unplaced (null) seats', () => {
    expect(occupancyOf([null, null]).size).toBe(0);
  });
});

describe('applyPlacement', () => {
  it('moves a seat and resets it to 1×1', () => {
    const before = [seat(1, 1, 90, 2, 2)];
    const after = applyPlacement(before, 0, 2, 3);
    expect(after[0]).toEqual({ col: 2, row: 3, colSpan: 1, rowSpan: 1, rot: 90 });
    expect(before[0].colSpan).toBe(2); // input not mutated
  });

  it('swaps two seats when dropping onto an occupied cell', () => {
    const before = [seat(1, 1, 0), seat(2, 2, 180)];
    const after = applyPlacement(before, 0, 2, 2); // seat 0 onto seat 1's cell
    expect(after[0]).toMatchObject({ col: 2, row: 2 });
    expect(after[1]).toMatchObject({ col: 1, row: 1, rot: 180 }); // displaced to mover's old cell
  });

  it('bumps the displaced seat to the tray when the mover came from the tray', () => {
    const before: (Placement | null)[] = [null, seat(2, 2, 0)];
    const after = applyPlacement(before, 0, 2, 2);
    expect(after[0]).toMatchObject({ col: 2, row: 2 });
    expect(after[1]).toBeNull();
  });
});

describe('rangeFree / rangeFreeRows', () => {
  const occ = occupancyOf([seat(1, 1), seat(2, 1), seat(1, 2)]);
  it('detects a free vertical range (ignoring self)', () => {
    expect(rangeFree(occ, 2, 1, 2, 99)).toBe(false); // 2,1 owned by seat 1, not ignored
    expect(rangeFree(occ, 2, 1, 2, 1)).toBe(true); // seat 1's cell ignored, 2,2 empty
    expect(rangeFree(occ, 2, 2, 1, 99)).toBe(true); // cell 2,2 is empty
  });
  it('detects a free row across columns', () => {
    expect(rangeFreeRows(occ, 1, 1, 2, 2)).toBe(true); // 1,2 owned by seat 2, ignored
    expect(rangeFreeRows(occ, 1, 1, 2, 0)).toBe(false); // 1,2 owned by seat 2, not ignored
  });
});

describe('deriveSeam', () => {
  it('uses a column seam for a single sideways row', () => {
    expect(deriveSeam(1, [seat(1, 1, 90), seat(2, 1, 270)])).toEqual({ col: 1 });
  });
  it('seams below the lowest 180° (far-side) row', () => {
    expect(deriveSeam(2, [seat(1, 1, 180), seat(2, 1, 180), seat(1, 2, 0)])).toEqual({
      row: 1,
    });
  });
  it('falls back to the middle row when nothing is flipped', () => {
    expect(deriveSeam(4, [seat(1, 1, 0), seat(2, 1, 0)])).toEqual({ row: 2 });
  });
});
