import { describe, it, expect } from 'vitest';
import { computeInsertIndex, effectiveSortIndex, reorderIndexForMove } from './deck-reorder';

describe('effectiveSortIndex', () => {
  it('prefers sortIndex over addedAt when set', () => {
    expect(effectiveSortIndex({ sortIndex: 5, addedAt: 100 })).toBe(5);
  });
  it('falls back to addedAt when never dragged', () => {
    expect(effectiveSortIndex({ addedAt: 100 })).toBe(100);
  });
});

describe('computeInsertIndex', () => {
  it('with no neighbors, returns 0', () => {
    expect(computeInsertIndex([], 0)).toBe(0);
  });
  it('inserting at the start goes below the first neighbor', () => {
    expect(computeInsertIndex([10, 20, 30], 0)).toBeLessThan(10);
  });
  it('inserting at the end goes above the last neighbor', () => {
    expect(computeInsertIndex([10, 20, 30], 3)).toBeGreaterThan(30);
  });
  it('inserting in the middle lands between the two flanking neighbors', () => {
    const idx = computeInsertIndex([10, 20, 30], 1);
    expect(idx).toBeGreaterThan(10);
    expect(idx).toBeLessThan(20);
    expect(idx).toBe(15);
  });
  it('clamps an out-of-range insertAt', () => {
    expect(computeInsertIndex([10, 20], 99)).toBeGreaterThan(20);
    expect(computeInsertIndex([10, 20], -5)).toBeLessThan(10);
  });
});

describe('reorderIndexForMove', () => {
  it('moving a row down lands it between its new neighbors', () => {
    const rows = [
      { addedAt: 10 }, // A, index 0
      { addedAt: 20 }, // B, index 1
      { addedAt: 30 }, // C, index 2
      { addedAt: 40 }, // D, index 3
    ];
    // Drag A (index 0) to land after B, before C — i.e. target index 1.
    const idx = reorderIndexForMove(rows, 0, 1);
    expect(idx).toBeGreaterThan(20);
    expect(idx).toBeLessThan(30);
  });

  it('moving a row to the very top only assigns ONE new index', () => {
    const rows = [{ addedAt: 10 }, { addedAt: 20 }, { addedAt: 30 }];
    const idx = reorderIndexForMove(rows, 2, 0);
    expect(idx).toBeLessThan(10);
  });

  it('does not rewrite every row — only computes the moved row’s index', () => {
    // reorderIndexForMove returns a single number; verify neighbors' own
    // addedAt/sortIndex values are never read as anything but inputs (no
    // mutation surface exists here at all — this guards the *contract*,
    // that callers only ever need to persist one slot's sortIndex per drag).
    const rows = [{ addedAt: 10 }, { addedAt: 20 }, { addedAt: 30 }, { addedAt: 40 }];
    const before = rows.map((r) => ({ ...r }));
    reorderIndexForMove(rows, 1, 3);
    expect(rows).toEqual(before);
  });

  it('respects an existing sortIndex over addedAt for both the moved row and neighbors', () => {
    const rows = [
      { addedAt: 10, sortIndex: 1000 },
      { addedAt: 20, sortIndex: 2000 },
      { addedAt: 30 },
    ];
    const idx = reorderIndexForMove(rows, 2, 0);
    expect(idx).toBeLessThan(1000);
  });
});
