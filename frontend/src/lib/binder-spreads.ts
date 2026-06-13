/**
 * Binder spread layout helpers for the ≥1024px two-page spread view.
 *
 * A "spread" is a pair of facing pages rendered side-by-side (left | spine |
 * right). Either side may be null when the page count is odd or when the
 * first spread needs an empty verso (double-sided mode).
 */

// ── Section tab types ──────────────────────────────────────────────────────

/** Input descriptor for a single section's index tab. */
export interface SectionTabInput {
  key: string;
  label: string;
  pip?: { background: string; border: string };
  /**
   * Flat (binder-wide) page index of this section's first page.
   * Determines which spread the tab belongs to and which side it appears on.
   */
  firstPageIndex: number;
}

/** A fully-positioned tab placement returned by `layoutSectionTabs`. */
export interface TabPlacement {
  key: string;
  label: string;
  pip?: { background: string; border: string };
  firstPageIndex: number;
  /** 'left' = section starts at or before this spread; 'right' = starts after. */
  side: 'left' | 'right';
  /** Distance from the top of the gutter column, in px. */
  top: number;
  /** Height of the tab in px. */
  height: number;
  /** 'full' shows a truncated label (~9ch); 'mini' shows only a pip or first char. */
  variant: 'full' | 'mini';
  /** True for the last left-side tab in section order (the section you're currently inside). */
  isCurrent: boolean;
}

/** Options for `layoutSectionTabs`. */
export interface TabLayoutOpts {
  /** Height of a full-label tab in px. Default: 56. */
  fullTabHeight?: number;
  /** Height of a mini (compressed) tab in px. Default: 30. */
  miniTabHeight?: number;
  /** Gap between adjacent tabs in px. Default: 6. */
  gap?: number;
}

export interface Spread {
  /** Index into the pages[] array, or null for a blank-side placeholder. */
  left: number | null;
  /** Index into the pages[] array, or null for a blank-side placeholder. */
  right: number | null;
}

/**
 * Build the ordered spread list for a given page count and binding mode.
 *
 * Double-sided (book/verso-recto) layout:
 *   - The first spread always has a blank left (cover back) with page 0 on the
 *     right — matches physical book convention where the first recto is alone.
 *   - Subsequent spreads pair even-index left with odd-index right.
 *   - A trailing odd page (after the first) becomes the left of a final spread
 *     with a blank right.
 *
 * Single-sided layout (simple pairs):
 *   - Pages pair sequentially: [0|1], [2|3], etc.
 *   - A trailing odd page becomes the left of a final spread with a blank right.
 */
export function buildSpreads(pageCount: number, doubleSided: boolean): Spread[] {
  if (pageCount === 0) return [];

  if (doubleSided) {
    // First spread: blank left, page 0 right (physical recto-opening).
    const spreads: Spread[] = [{ left: null, right: 0 }];
    // Pair remaining pages: page 1+2, 3+4, … verso/recto pairs.
    for (let i = 1; i < pageCount; i += 2) {
      if (i + 1 < pageCount) {
        spreads.push({ left: i, right: i + 1 });
      } else {
        // Trailing odd page — sits alone on the left (verso, no backing recto).
        spreads.push({ left: i, right: null });
      }
    }
    return spreads;
  } else {
    // Simple pairs: [0|1], [2|3], …
    const spreads: Spread[] = [];
    for (let i = 0; i < pageCount; i += 2) {
      if (i + 1 < pageCount) {
        spreads.push({ left: i, right: i + 1 });
      } else {
        spreads.push({ left: i, right: null });
      }
    }
    return spreads;
  }
}

/**
 * Find which spread index contains the given page index.
 * Returns -1 if the page is not present in any spread (should not happen with
 * a well-formed spreads array).
 */
export function spreadIndexForPage(spreads: Spread[], pageIndex: number): number {
  for (let i = 0; i < spreads.length; i++) {
    const s = spreads[i];
    if (s.left === pageIndex || s.right === pageIndex) return i;
  }
  return -1;
}

// ── layoutSectionTabs ──────────────────────────────────────────────────────

/**
 * Compute fully-positioned index-tab placements for a given spread.
 *
 * Side split:
 *   - 'left'  → the section's first page is on this spread or an earlier one
 *               (passed / current sections).
 *   - 'right' → the section's first page is on a later spread (upcoming).
 *
 * The "current" section is the LAST left-side tab in section order — it is the
 * section whose pages this spread is currently showing.
 *
 * Compression ladder (per side, decided independently):
 *   1. All tabs fit at fullTabHeight  → variant 'full'.
 *   2. All tabs fit at miniTabHeight  → all 'mini'.
 *   3. SAMPLE: keep first + last + (left only) current tab; fill remaining
 *      capacity with evenly-spaced picks from the middle; everything 'mini'.
 *      Dropped tabs are absent from the output.
 *
 * Containment contract (hard):
 *   For every returned placement:  top ≥ 0  AND  top + height ≤ gutterHeight.
 *   When gutterHeight ≤ 0, returns [].
 */
export function layoutSectionTabs(
  tabs: SectionTabInput[],
  spreadIndex: number,
  spreads: Spread[],
  gutterHeight: number,
  opts?: TabLayoutOpts
): TabPlacement[] {
  const fullTabHeight = opts?.fullTabHeight ?? 56;
  const miniTabHeight = opts?.miniTabHeight ?? 30;
  const gap = opts?.gap ?? 6;

  if (gutterHeight <= 0 || tabs.length === 0) return [];

  // ── 1. Classify each tab into left or right ────────────────────────────
  const leftTabs: SectionTabInput[] = [];
  const rightTabs: SectionTabInput[] = [];

  for (const tab of tabs) {
    const tabSpread = spreadIndexForPage(spreads, tab.firstPageIndex);
    // A tab whose section's first page isn't in any spread goes right (upcoming).
    if (tabSpread === -1 || tabSpread > spreadIndex) {
      rightTabs.push(tab);
    } else {
      leftTabs.push(tab);
    }
  }

  // The current section is the LAST left-side tab in input (section) order.
  const currentKey = leftTabs.length > 0 ? leftTabs[leftTabs.length - 1].key : null;

  // ── 2. Lay out each side ───────────────────────────────────────────────
  const placements: TabPlacement[] = [
    ...layoutSide(leftTabs, 'left', currentKey, gutterHeight, fullTabHeight, miniTabHeight, gap),
    ...layoutSide(rightTabs, 'right', null, gutterHeight, fullTabHeight, miniTabHeight, gap),
  ];

  return placements;
}

/** Internal helper: lay out tabs for a single gutter side. */
function layoutSide(
  tabs: SectionTabInput[],
  side: 'left' | 'right',
  currentKey: string | null,
  gutterHeight: number,
  fullTabHeight: number,
  miniTabHeight: number,
  gap: number
): TabPlacement[] {
  if (tabs.length === 0) return [];

  /** Total vertical space consumed by N tabs at a given height. */
  function totalHeight(count: number, height: number): number {
    return count * height + Math.max(0, count - 1) * gap;
  }

  // ── Compression ladder ─────────────────────────────────────────────────

  // Try full height first.
  if (totalHeight(tabs.length, fullTabHeight) <= gutterHeight) {
    return stackTabs(tabs, side, currentKey, fullTabHeight, gap, 'full');
  }

  // Try mini height.
  if (totalHeight(tabs.length, miniTabHeight) <= gutterHeight) {
    return stackTabs(tabs, side, currentKey, miniTabHeight, gap, 'mini');
  }

  // SAMPLE: figure out how many mini tabs fit.
  // capacity = floor((gutterHeight + gap) / (miniTabHeight + gap))
  const capacity = Math.floor((gutterHeight + gap) / (miniTabHeight + gap));
  if (capacity <= 0) return [];

  const sampled = sampleTabs(tabs, capacity, currentKey, side);
  return stackTabs(sampled, side, currentKey, miniTabHeight, gap, 'mini');
}

/** Stack N tabs from top, assign top/height/variant/isCurrent. */
function stackTabs(
  tabs: SectionTabInput[],
  side: 'left' | 'right',
  currentKey: string | null,
  height: number,
  gap: number,
  variant: 'full' | 'mini'
): TabPlacement[] {
  return tabs.map((tab, i) => ({
    key: tab.key,
    label: tab.label,
    pip: tab.pip,
    firstPageIndex: tab.firstPageIndex,
    side,
    top: i * (height + gap),
    height,
    variant,
    isCurrent: tab.key === currentKey,
  }));
}

/**
 * Sample `capacity` tabs from `tabs`, always keeping:
 *   - first tab (index 0)
 *   - last tab (index n-1)
 *   - (left side) current tab
 * Then fill remaining slots with evenly-spaced picks from the middle range.
 * Returns the selected tabs in original order.
 *
 * Hard contract: returns exactly `capacity` tabs (or fewer when n ≤ capacity).
 * When the mandatory-keep set (current > first > last) exceeds `capacity`, it
 * is trimmed by priority so the containment invariant top+height ≤ gutterHeight
 * is never violated.
 */
function sampleTabs(
  tabs: SectionTabInput[],
  capacity: number,
  currentKey: string | null,
  side: 'left' | 'right'
): SectionTabInput[] {
  const n = tabs.length;
  if (n <= capacity) return tabs;
  if (capacity <= 0) return [];

  // Build the mandatory-keep set (indices) in priority order: current > first > last.
  const keepIndices = new Set<number>();

  // Find current index (left side only).
  let currentIdx = -1;
  if (side === 'left' && currentKey !== null) {
    currentIdx = tabs.findIndex((t) => t.key === currentKey);
  }

  // Add in priority order, stopping when we hit capacity.
  if (currentIdx >= 0 && keepIndices.size < capacity) keepIndices.add(currentIdx);
  if (keepIndices.size < capacity) keepIndices.add(0);
  if (keepIndices.size < capacity) keepIndices.add(n - 1);

  // If mandatory set already fills (or exceeds) capacity, return those in order.
  if (keepIndices.size >= capacity) {
    return tabs.filter((_, i) => keepIndices.has(i));
  }

  // Remaining capacity to fill from the middle.
  const remaining = capacity - keepIndices.size;
  if (remaining > 0) {
    // Collect non-mandatory indices (exclude first and last).
    const candidates: number[] = [];
    for (let i = 1; i < n - 1; i++) {
      if (!keepIndices.has(i)) candidates.push(i);
    }
    // Evenly spaced picks across candidates.
    if (candidates.length > 0) {
      const step = candidates.length / remaining;
      for (let k = 0; k < remaining && k < candidates.length; k++) {
        const picked = candidates[Math.round(k * step + step / 2 - 0.5)];
        if (picked !== undefined) keepIndices.add(picked);
      }
    }
  }

  // Return in original order.
  return tabs.filter((_, i) => keepIndices.has(i));
}
