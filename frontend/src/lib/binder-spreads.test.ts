import { describe, it, expect } from 'vitest';
import { buildSpreads, spreadIndexForPage } from './binder-spreads';
import type { Spread } from './binder-spreads';

// ── buildSpreads: edge cases ──────────────────────────────────────────────

describe('buildSpreads — edge cases', () => {
  it('returns [] for pageCount 0, either mode', () => {
    expect(buildSpreads(0, true)).toEqual([]);
    expect(buildSpreads(0, false)).toEqual([]);
  });

  it('1-page double-sided: blank left, page 0 right', () => {
    expect(buildSpreads(1, true)).toEqual([{ left: null, right: 0 }]);
  });

  it('1-page single-sided: page 0 left, blank right', () => {
    expect(buildSpreads(1, false)).toEqual([{ left: 0, right: null }]);
  });

  it('2-page double-sided: blank|0 then 1|null', () => {
    expect(buildSpreads(2, true)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: null },
    ]);
  });

  it('2-page single-sided: exactly one spread [0|1]', () => {
    expect(buildSpreads(2, false)).toEqual([{ left: 0, right: 1 }]);
  });
});

// ── buildSpreads: double-sided (book/verso-recto) ─────────────────────────

describe('buildSpreads — double-sided', () => {
  it('even page count (4 pages): blank|0, 1|2, 3|null', () => {
    // 4 pages → 3 spreads
    expect(buildSpreads(4, true)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: 2 },
      { left: 3, right: null },
    ]);
  });

  it('odd page count (5 pages): blank|0, 1|2, 3|4', () => {
    expect(buildSpreads(5, true)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: 2 },
      { left: 3, right: 4 },
    ]);
  });

  it('6 pages: blank|0, 1|2, 3|4, 5|null', () => {
    expect(buildSpreads(6, true)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: 2 },
      { left: 3, right: 4 },
      { left: 5, right: null },
    ]);
  });

  it('3 pages: blank|0, 1|2', () => {
    expect(buildSpreads(3, true)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: 2 },
    ]);
  });

  it('every page index appears exactly once across all spreads', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const spreads = buildSpreads(count, true);
      const seen = new Set<number>();
      for (const s of spreads) {
        if (s.left !== null) {
          expect(seen.has(s.left)).toBe(false);
          seen.add(s.left);
        }
        if (s.right !== null) {
          expect(seen.has(s.right)).toBe(false);
          seen.add(s.right);
        }
      }
      for (let i = 0; i < count; i++) {
        expect(seen.has(i)).toBe(true);
      }
    }
  });

  it('spread count = ceil((pageCount + 1) / 2)', () => {
    // +1 because the first spread consumes only 1 page (right side), then pairs of 2
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const spreads = buildSpreads(count, true);
      const expected = Math.ceil((count + 1) / 2);
      expect(spreads.length).toBe(expected);
    }
  });
});

// ── buildSpreads: single-sided (simple pairs) ──────────────────────────────

describe('buildSpreads — single-sided', () => {
  it('4 pages: [0|1], [2|3]', () => {
    expect(buildSpreads(4, false)).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: 3 },
    ]);
  });

  it('5 pages: [0|1], [2|3], [4|null]', () => {
    expect(buildSpreads(5, false)).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: 3 },
      { left: 4, right: null },
    ]);
  });

  it('6 pages: 3 spreads, no trailing blank', () => {
    const spreads = buildSpreads(6, false);
    expect(spreads).toHaveLength(3);
    expect(spreads[2]).toEqual({ left: 4, right: 5 });
  });

  it('3 pages: [0|1], [2|null]', () => {
    expect(buildSpreads(3, false)).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: null },
    ]);
  });

  it('every page index appears exactly once across all spreads', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7]) {
      const spreads = buildSpreads(count, false);
      const seen = new Set<number>();
      for (const s of spreads) {
        if (s.left !== null) {
          expect(seen.has(s.left)).toBe(false);
          seen.add(s.left);
        }
        if (s.right !== null) {
          expect(seen.has(s.right)).toBe(false);
          seen.add(s.right);
        }
      }
      for (let i = 0; i < count; i++) {
        expect(seen.has(i)).toBe(true);
      }
    }
  });

  it('spread count = ceil(pageCount / 2)', () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      expect(buildSpreads(count, false).length).toBe(Math.ceil(count / 2));
    }
  });

  it('left side has the lower index, right side higher (or null)', () => {
    const spreads = buildSpreads(7, false);
    for (const s of spreads) {
      if (s.left !== null && s.right !== null) {
        expect(s.left).toBeLessThan(s.right);
      }
    }
  });
});

// ── spreadIndexForPage ─────────────────────────────────────────────────────

describe('spreadIndexForPage', () => {
  it('finds page 0 in a double-sided layout (right side of spread 0)', () => {
    const spreads = buildSpreads(4, true);
    expect(spreadIndexForPage(spreads, 0)).toBe(0);
  });

  it('finds each page in its correct spread (double-sided)', () => {
    const spreads = buildSpreads(6, true);
    // blank|0, 1|2, 3|4, 5|null
    expect(spreadIndexForPage(spreads, 0)).toBe(0);
    expect(spreadIndexForPage(spreads, 1)).toBe(1);
    expect(spreadIndexForPage(spreads, 2)).toBe(1);
    expect(spreadIndexForPage(spreads, 3)).toBe(2);
    expect(spreadIndexForPage(spreads, 4)).toBe(2);
    expect(spreadIndexForPage(spreads, 5)).toBe(3);
  });

  it('finds each page in its correct spread (single-sided)', () => {
    const spreads = buildSpreads(6, false);
    // [0|1], [2|3], [4|5]
    expect(spreadIndexForPage(spreads, 0)).toBe(0);
    expect(spreadIndexForPage(spreads, 1)).toBe(0);
    expect(spreadIndexForPage(spreads, 2)).toBe(1);
    expect(spreadIndexForPage(spreads, 3)).toBe(1);
    expect(spreadIndexForPage(spreads, 4)).toBe(2);
    expect(spreadIndexForPage(spreads, 5)).toBe(2);
  });

  it('returns -1 for an out-of-range page index', () => {
    const spreads = buildSpreads(4, false);
    expect(spreadIndexForPage(spreads, 99)).toBe(-1);
  });

  it('returns -1 for an empty spread array', () => {
    expect(spreadIndexForPage([], 0)).toBe(-1);
  });

  it('every page index in a 10-page layout maps to exactly one spread', () => {
    for (const doubleSided of [true, false]) {
      const spreads = buildSpreads(10, doubleSided);
      for (let i = 0; i < 10; i++) {
        const idx = spreadIndexForPage(spreads, i);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(spreads.length);
        // verify the found spread actually contains this page
        const found = spreads[idx] as Spread;
        expect(found.left === i || found.right === i).toBe(true);
      }
    }
  });

  it('page 0 double-sided maps to spread 0 for any page count ≥ 1', () => {
    for (const count of [1, 2, 3, 5, 10]) {
      const spreads = buildSpreads(count, true);
      expect(spreadIndexForPage(spreads, 0)).toBe(0);
    }
  });
});
