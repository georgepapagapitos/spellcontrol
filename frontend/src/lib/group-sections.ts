import type { SectionMeta } from '@spellcontrol/binder-routing';

export interface SectionHeader {
  meta: SectionMeta;
  /** Total rows in this section (across the whole grouped list, not just the visible window). */
  count: number;
}

export interface GroupedSections<T> {
  /** Rows reordered so each section is contiguous; order *within* a section is preserved. */
  rows: T[];
  /** Index in `rows` → the header that opens a new section at that index. */
  headers: Map<number, SectionHeader>;
}

/**
 * Stable-group `rows` into contiguous sections using `getMeta`.
 *
 * Sections are ordered by `meta.order`, then `meta.key` (so distinct sections
 * that share an `order` — e.g. `getSectionMeta`'s `setName`, which returns
 * `order: 0` for every set — still cluster instead of interleaving), then the
 * original index. Because the original index is the final tiebreak, rows within
 * a section keep the incoming order (i.e. the caller's active sort).
 *
 * Framework-free + pure so it can drive any virtualized list and be unit-tested
 * without React.
 */
export function groupRowsIntoSections<T>(
  rows: readonly T[],
  getMeta: (row: T) => SectionMeta
): GroupedSections<T> {
  const tagged = rows.map((row, i) => ({ row, i, meta: getMeta(row) }));
  tagged.sort(
    (a, b) =>
      a.meta.order - b.meta.order ||
      (a.meta.key < b.meta.key ? -1 : a.meta.key > b.meta.key ? 1 : 0) ||
      a.i - b.i
  );

  const counts = new Map<string, number>();
  for (const t of tagged) counts.set(t.meta.key, (counts.get(t.meta.key) ?? 0) + 1);

  const headers = new Map<number, SectionHeader>();
  let prevKey: string | null = null;
  tagged.forEach((t, idx) => {
    if (t.meta.key !== prevKey) {
      headers.set(idx, { meta: t.meta, count: counts.get(t.meta.key) ?? 0 });
      prevKey = t.meta.key;
    }
  });

  return { rows: tagged.map((t) => t.row), headers };
}

/**
 * One row of the grouped grid: either a full-width section header or a run of
 * up to `gridCols` card indices. `cards` rows carry `[start, end)` indices into
 * the flat grouped row list (see `displayRows` in CardListTable).
 */
export type GridLayoutRow =
  | { kind: 'header'; meta: SectionHeader['meta']; count: number }
  | { kind: 'cards'; start: number; end: number };

/**
 * Flatten `rowCount` cards (already grouped/ordered) into the heterogeneous row
 * list a virtualized grid renders: a full-width header opens each section, then
 * that section's cards chunk into rows of `gridCols`.
 *
 * `trailingItems` (0 or 1 in practice) appends extra non-card slots — the
 * collection grid's Scryfall "add" trigger — after the last card. Ungrouped, it
 * fills the final partial card row (matching the pre-grouping layout); grouped,
 * it lands on its own trailing row after every section.
 *
 * `collapsed` is the set of section `meta.key`s whose cards are hidden: the
 * header still emits, but its card chunks are skipped (the section folds to its
 * header alone).
 *
 * Pure so the grid virtualizer's row count + per-row height estimate can be
 * derived without React and unit-tested directly.
 */
export function buildGridLayout(
  rowCount: number,
  gridCols: number,
  sectionHeaders: Map<number, SectionHeader> | null,
  trailingItems = 0,
  collapsed?: ReadonlySet<string>
): GridLayoutRow[] {
  const cols = Math.max(1, gridCols);
  const out: GridLayoutRow[] = [];
  const chunk = (from: number, to: number) => {
    for (let i = from; i < to; i += cols) {
      out.push({ kind: 'cards', start: i, end: Math.min(i + cols, to) });
    }
  };

  if (!sectionHeaders || sectionHeaders.size === 0) {
    chunk(0, rowCount + trailingItems);
    return out;
  }

  const boundaries = [...sectionHeaders.keys()].sort((a, b) => a - b);
  boundaries.forEach((startIdx, bi) => {
    const endIdx = bi + 1 < boundaries.length ? boundaries[bi + 1] : rowCount;
    const header = sectionHeaders.get(startIdx);
    if (header) out.push({ kind: 'header', meta: header.meta, count: header.count });
    if (!header || !collapsed?.has(header.meta.key)) chunk(startIdx, endIdx);
  });
  if (trailingItems > 0) chunk(rowCount, rowCount + trailingItems);
  return out;
}

/**
 * One row of the grouped list/compact view: either a section header or a single
 * card (`index` into the flat grouped row list). The list mirrors the grid's
 * header-as-own-row model so a collapsed section keeps a tappable header with no
 * card rows below it.
 */
export type ListLayoutRow =
  | { kind: 'header'; meta: SectionHeader['meta']; count: number }
  | { kind: 'card'; index: number };

/**
 * Flatten `rowCount` grouped cards into the list/compact virtualizer's row list:
 * a header opens each section, then one row per card (collapsed sections emit
 * only their header). With no `sectionHeaders` it's a flat run of card rows.
 *
 * Pure for direct unit testing, like {@link buildGridLayout}.
 */
export function buildListLayout(
  rowCount: number,
  sectionHeaders: Map<number, SectionHeader> | null,
  collapsed?: ReadonlySet<string>
): ListLayoutRow[] {
  const out: ListLayoutRow[] = [];
  if (!sectionHeaders || sectionHeaders.size === 0) {
    for (let i = 0; i < rowCount; i++) out.push({ kind: 'card', index: i });
    return out;
  }
  const boundaries = [...sectionHeaders.keys()].sort((a, b) => a - b);
  boundaries.forEach((startIdx, bi) => {
    const endIdx = bi + 1 < boundaries.length ? boundaries[bi + 1] : rowCount;
    const header = sectionHeaders.get(startIdx);
    if (header) out.push({ kind: 'header', meta: header.meta, count: header.count });
    if (!header || !collapsed?.has(header.meta.key)) {
      for (let i = startIdx; i < endIdx; i++) out.push({ kind: 'card', index: i });
    }
  });
  return out;
}
