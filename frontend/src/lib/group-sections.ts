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
