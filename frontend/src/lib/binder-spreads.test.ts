import { describe, it, expect } from 'vitest';
import { buildSpreads, spreadIndexForPage, layoutSectionTabs } from './binder-spreads';
import type { Spread, SectionTabInput } from './binder-spreads';

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

// ── layoutSectionTabs ──────────────────────────────────────────────────────

// Helper: build a simple n-section binder with 1 page each (single-sided).
function mkTabsAndSpreads(n: number): { tabs: SectionTabInput[]; spreads: Spread[] } {
  const tabs: SectionTabInput[] = Array.from({ length: n }, (_, i) => ({
    key: `s${i}`,
    label: `Section ${i}`,
    firstPageIndex: i, // 1 page per section
  }));
  const spreads = buildSpreads(n, false);
  return { tabs, spreads };
}

describe('layoutSectionTabs — edge cases', () => {
  it('returns [] when gutterHeight is 0', () => {
    const { tabs, spreads } = mkTabsAndSpreads(4);
    expect(layoutSectionTabs(tabs, 0, spreads, 0)).toEqual([]);
  });

  it('returns [] when gutterHeight is negative', () => {
    const { tabs, spreads } = mkTabsAndSpreads(4);
    expect(layoutSectionTabs(tabs, 0, spreads, -1)).toEqual([]);
  });

  it('returns [] when tabs array is empty', () => {
    const spreads = buildSpreads(4, false);
    expect(layoutSectionTabs([], 0, spreads, 600)).toEqual([]);
  });

  it('single tab always appears as a left tab (spread 0, section 0)', () => {
    const { tabs, spreads } = mkTabsAndSpreads(1);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe('left');
    expect(result[0].isCurrent).toBe(true);
  });

  it('output is deterministic — same inputs produce identical output', () => {
    const { tabs, spreads } = mkTabsAndSpreads(8);
    const a = layoutSectionTabs(tabs, 1, spreads, 600);
    const b = layoutSectionTabs(tabs, 1, spreads, 600);
    expect(a).toEqual(b);
  });
});

describe('layoutSectionTabs — side split', () => {
  it('3 sections: at spread 0, section 0 is left, sections 1+2 are right', () => {
    // 3 sections, 1 page each, single-sided: spreads = [0|1], [2|null]
    // spread 0 contains pages 0 and 1
    // section 0 (page 0) → spread 0 ≤ 0 → left
    // section 1 (page 1) → spread 0 ≤ 0 → left
    // section 2 (page 2) → spread 1 > 0 → right
    const { tabs, spreads } = mkTabsAndSpreads(3);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    const leftKeys = result.filter((p) => p.side === 'left').map((p) => p.key);
    const rightKeys = result.filter((p) => p.side === 'right').map((p) => p.key);
    expect(leftKeys).toContain('s0');
    expect(leftKeys).toContain('s1');
    expect(rightKeys).toContain('s2');
  });

  it('at the last spread, all sections are on the left', () => {
    const { tabs, spreads } = mkTabsAndSpreads(4);
    const lastSpreadIdx = spreads.length - 1;
    const result = layoutSectionTabs(tabs, lastSpreadIdx, spreads, 600);
    expect(result.every((p) => p.side === 'left')).toBe(true);
  });

  it('at the first spread, the first section(s) are left and later sections are right', () => {
    // 4 sections, single-sided: spreads = [0|1],[2|3]
    // spread 0 contains pages 0,1 → sections 0 and 1 are left, sections 2,3 are right
    const { tabs, spreads } = mkTabsAndSpreads(4);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    const left = result.filter((p) => p.side === 'left');
    const right = result.filter((p) => p.side === 'right');
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(right.length).toBeGreaterThanOrEqual(1);
  });
});

describe('layoutSectionTabs — isCurrent', () => {
  it('isCurrent is the LAST left tab in section order', () => {
    // 3 sections, single-sided: at spread 0 → sections 0+1 are left, 2 is right
    // last left = section 1 → isCurrent
    const { tabs, spreads } = mkTabsAndSpreads(3);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    const current = result.filter((p) => p.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].key).toBe('s1');
  });

  it('isCurrent is false for all right-side tabs', () => {
    const { tabs, spreads } = mkTabsAndSpreads(4);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    const rightCurrent = result.filter((p) => p.side === 'right' && p.isCurrent);
    expect(rightCurrent).toHaveLength(0);
  });

  it('exactly one tab has isCurrent when there is at least one left tab', () => {
    const { tabs, spreads } = mkTabsAndSpreads(8);
    // Test every spread index
    for (let si = 0; si < spreads.length; si++) {
      const result = layoutSectionTabs(tabs, si, spreads, 900);
      const currentCount = result.filter((p) => p.isCurrent).length;
      // There will always be at least one left tab (section 0 starts at page 0 = spread 0 ≤ si)
      expect(currentCount).toBe(1);
    }
  });
});

describe('layoutSectionTabs — containment contract', () => {
  const gutterHeights = [300, 600, 900];
  const sectionCounts = [2, 8, 27, 40];

  for (const gh of gutterHeights) {
    for (const n of sectionCounts) {
      it(`top ≥ 0 and top+height ≤ gutterHeight for n=${n}, gutterHeight=${gh}`, () => {
        const { tabs, spreads } = mkTabsAndSpreads(n);
        for (let si = 0; si < spreads.length; si++) {
          const result = layoutSectionTabs(tabs, si, spreads, gh);
          for (const p of result) {
            expect(p.top).toBeGreaterThanOrEqual(0);
            expect(p.top + p.height).toBeLessThanOrEqual(gh);
          }
        }
      });
    }
  }

  it('containment holds with gutterHeight=0 (returns [])', () => {
    const { tabs, spreads } = mkTabsAndSpreads(8);
    const result = layoutSectionTabs(tabs, 1, spreads, 0);
    expect(result).toHaveLength(0);
  });
});

describe('layoutSectionTabs — compression ladder', () => {
  it('2 tabs, large gutter → full variant', () => {
    const { tabs, spreads } = mkTabsAndSpreads(2);
    const result = layoutSectionTabs(tabs, 0, spreads, 900);
    expect(result.every((p) => p.variant === 'full')).toBe(true);
  });

  it('many tabs, small gutter → mini variant when full does not fit', () => {
    // 8-section binder: at middle spread several tabs land on each side.
    // gutterHeight=80: full=56px → 2 tabs need 56+6+56=118 > 80 → no full.
    // mini=30px → 2 tabs need 30+6+30=66 ≤ 80 → mini works.
    const { tabs, spreads } = mkTabsAndSpreads(8);
    // At spread 3 (0-indexed): sections 0..6 (page 0..6) start ≤ spread 3,
    // section 7 (page 7) starts on spread 3 or 4.  Pick a middle spread so
    // both sides have ≥2 tabs each.
    const result = layoutSectionTabs(tabs, 3, spreads, 80);
    const withFull = result.filter((p) => p.variant === 'full');
    // A side with ≥2 tabs at this gutter can't go full (118 > 80).
    // If a side has only 1 tab, it might be full — check per-side.
    for (const side of ['left', 'right'] as const) {
      const sideTabs = result.filter((p) => p.side === side);
      if (sideTabs.length >= 2) {
        expect(sideTabs.every((p) => p.variant === 'mini')).toBe(true);
      }
    }
    // Containment must hold.
    for (const p of result) {
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top + p.height).toBeLessThanOrEqual(80);
    }
    void withFull; // suppress unused var warning
  });

  it('40 sections at gutterHeight 300 → sampled output respects containment', () => {
    const { tabs, spreads } = mkTabsAndSpreads(40);
    for (let si = 0; si < spreads.length; si++) {
      const result = layoutSectionTabs(tabs, si, spreads, 300);
      for (const p of result) {
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top + p.height).toBeLessThanOrEqual(300);
      }
    }
  });

  it('sampled output always includes first and last tab of each side', () => {
    // 27 tabs, small gutter forces sampling
    const { tabs, spreads } = mkTabsAndSpreads(27);
    // At spread 13 (middle), there should be left and right tabs
    const result = layoutSectionTabs(tabs, 13, spreads, 300);
    const leftTabs = result.filter((p) => p.side === 'left');
    const rightTabs = result.filter((p) => p.side === 'right');
    if (leftTabs.length >= 2) {
      const leftKeys = leftTabs.map((p) => p.key);
      expect(leftKeys[0]).toBe('s0'); // first left tab is always section 0
    }
    if (rightTabs.length >= 2) {
      const rightKeys = rightTabs.map((p) => p.key);
      expect(rightKeys[rightKeys.length - 1]).toBe('s26'); // last right is always last section
    }
  });

  it('sampled output includes the current tab on the left side', () => {
    // 27 sections, tiny gutter forces sampling; current tab must survive
    const { tabs, spreads } = mkTabsAndSpreads(27);
    const result = layoutSectionTabs(tabs, 5, spreads, 200);
    const leftResult = result.filter((p) => p.side === 'left');
    const hasCurrentInOutput = leftResult.some((p) => p.isCurrent);
    if (leftResult.length > 0) {
      expect(hasCurrentInOutput).toBe(true);
    }
  });
});

describe('sampleTabs — tiny capacity containment (Fix 2)', () => {
  // These tests exercise the mandatory-keep trim path: when first+last+current
  // exceed `capacity`, the function must trim by priority (current > first > last)
  // and return exactly `capacity` tabs so top+height ≤ gutterHeight never fires.

  // Helper: drive the sampling path by using a gutter that forces exactly
  // `capacity` mini tabs to fit.  miniTabHeight=30, gap=6 → capacity = floor((gh+6)/(36)).
  // We pick gh so that exactly N mini tabs fit: gh = N*(30+6)-6 = N*36-6.
  function ghForCapacity(n: number) {
    return n * 36 - 6;
  }

  it('capacity 1, left side with a current tab → only the current tab survives', () => {
    // 5 sections, single-sided: at spread 2 ([4|null]) all 5 sections are left.
    // current = last left = s4.  capacity=1 → only s4 survives.
    const { tabs, spreads } = mkTabsAndSpreads(5);
    const gh = ghForCapacity(1); // 30px → floor((30+6)/36)=1
    const result = layoutSectionTabs(tabs, 2, spreads, gh);
    const left = result.filter((p) => p.side === 'left');
    expect(left).toHaveLength(1);
    expect(left[0].isCurrent).toBe(true);
    for (const p of result) expect(p.top + p.height).toBeLessThanOrEqual(gh);
  });

  it('capacity 1, right side (no current) → only the first right tab survives', () => {
    // 5 sections at spread 0 ([0|1]): s0, s1 are left; s2, s3, s4 are right.
    // right has no current; mandatory: first (s2) only.
    const { tabs, spreads } = mkTabsAndSpreads(5);
    const gh = ghForCapacity(1);
    const result = layoutSectionTabs(tabs, 0, spreads, gh);
    const right = result.filter((p) => p.side === 'right');
    expect(right).toHaveLength(1);
    expect(right[0].key).toBe('s2'); // first right tab
    for (const p of result) expect(p.top + p.height).toBeLessThanOrEqual(gh);
  });

  it('capacity 2, left side with a current tab → current + first survive', () => {
    // 5 sections at spread 2: all left; current = s4, first = s0.
    // capacity=2 → {current=s4, first=s0} — last (s4) is already current,
    // so keepIndices = {4, 0} (size=2, no room for last separately).
    const { tabs, spreads } = mkTabsAndSpreads(5);
    const gh = ghForCapacity(2); // 66px → floor((66+6)/36)=2
    const result = layoutSectionTabs(tabs, 2, spreads, gh);
    const left = result.filter((p) => p.side === 'left');
    expect(left).toHaveLength(2);
    const keys = left.map((p) => p.key);
    expect(keys).toContain('s4'); // current
    expect(keys).toContain('s0'); // first
    for (const p of result) expect(p.top + p.height).toBeLessThanOrEqual(gh);
  });

  it('containment invariant holds for all tiny capacities 1–3 across all spreads (10 sections)', () => {
    const { tabs, spreads } = mkTabsAndSpreads(10);
    for (let cap = 1; cap <= 3; cap++) {
      const gh = ghForCapacity(cap);
      for (let si = 0; si < spreads.length; si++) {
        const result = layoutSectionTabs(tabs, si, spreads, gh);
        for (const p of result) {
          expect(p.top).toBeGreaterThanOrEqual(0);
          expect(p.top + p.height).toBeLessThanOrEqual(gh);
        }
      }
    }
  });
});

describe('layoutSectionTabs — pip forwarding', () => {
  it('pip is forwarded from tab input to placement', () => {
    const pip = { background: '#fff', border: '#000' };
    const tabs: SectionTabInput[] = [
      { key: 'a', label: 'White', firstPageIndex: 0, pip },
      { key: 'b', label: 'Blue', firstPageIndex: 2 },
    ];
    const spreads = buildSpreads(4, false);
    const result = layoutSectionTabs(tabs, 0, spreads, 600);
    const aPlacement = result.find((p) => p.key === 'a');
    const bPlacement = result.find((p) => p.key === 'b');
    expect(aPlacement?.pip).toEqual(pip);
    expect(bPlacement?.pip).toBeUndefined();
  });
});
