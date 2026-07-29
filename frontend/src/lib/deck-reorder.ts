// Manual drag-reorder math for the deck editor's "Custom order" sort mode
// (E172). A dragged row gets ONE persisted `DeckCard.sortIndex` — a sparse,
// fractional value inserted between its new neighbors' EFFECTIVE indices —
// so a single drag never rewrites every row in the section (same "one write
// regardless of size" discipline as `resyncDeck`/`setCardTags`, applied to
// a single row's index instead of the whole zone).
//
// Rows that have never been dragged carry no `sortIndex` at all; they sort
// by `addedAt` (an existing, real, monotonic per-slot field) as a free,
// zero-write default order. Because a fresh drag's inserted index is the
// midpoint between its neighbors' EFFECTIVE index (sortIndex ?? addedAt),
// and addedAt is a unix-ms timestamp, the two scales interoperate without
// any normalization pass — an index landing between two never-dragged rows
// comes out in the same ms range, comparable on sight.
import { arrayMove } from '@dnd-kit/sortable';

export interface ReorderableRow {
  sortIndex?: number;
  addedAt: number;
}

/** The value 'custom' sort compares rows by. */
export function effectiveSortIndex(row: ReorderableRow): number {
  return row.sortIndex ?? row.addedAt;
}

// Wider than any realistic gap between two neighbors' effective indices.
// ponytail: plain float midpoint halving, no LexoRank-style string ranks —
// at deck-list scale (hundreds of drags, not millions) float precision runs
// out only after ~50 repeated inserts at the exact same spot.
const GAP = 1000;

/**
 * The sortIndex to assign a row inserted at `insertAt` (0-based) among
 * `neighborEffectiveIndices` — every OTHER row in the same section, already
 * ascending-sorted, with the moved row excluded. Only this ONE value is ever
 * computed/written; nothing else in the section is touched.
 */
export function computeInsertIndex(neighborEffectiveIndices: number[], insertAt: number): number {
  if (neighborEffectiveIndices.length === 0) return 0;
  const clamped = Math.max(0, Math.min(insertAt, neighborEffectiveIndices.length));
  if (clamped === 0) return neighborEffectiveIndices[0] - GAP;
  if (clamped === neighborEffectiveIndices.length) {
    return neighborEffectiveIndices[clamped - 1] + GAP;
  }
  return (neighborEffectiveIndices[clamped - 1] + neighborEffectiveIndices[clamped]) / 2;
}

/**
 * Given a section's rows in their CURRENT displayed order and the dragged
 * row's old/new index within that same array (dnd-kit's `active`/`over`
 * indices — same semantics as `@dnd-kit/sortable`'s own `arrayMove`), returns
 * the sortIndex to persist for the dragged row.
 */
export function reorderIndexForMove<T extends ReorderableRow>(
  orderedRows: T[],
  fromIndex: number,
  toIndex: number
): number {
  const moved = orderedRows[fromIndex];
  const after = arrayMove(orderedRows, fromIndex, toIndex);
  const finalPos = after.indexOf(moved);
  const neighbors = after.filter((_, i) => i !== finalPos).map(effectiveSortIndex);
  return computeInsertIndex(neighbors, finalPos);
}
