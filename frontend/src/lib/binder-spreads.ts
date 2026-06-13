/**
 * Binder spread layout helpers for the ≥1024px two-page spread view.
 *
 * A "spread" is a pair of facing pages rendered side-by-side (left | spine |
 * right). Either side may be null when the page count is odd or when the
 * first spread needs an empty verso (double-sided mode).
 */

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
