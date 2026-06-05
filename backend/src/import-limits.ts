import type { ImportRow } from './parsers/types';

/**
 * Caps for the import expansion step. Parsers `parseInt()` the quantity field
 * with no upper bound, so a tiny payload (`Sol Ring,2000000000`) would
 * otherwise expand into a multi-billion-element array and OOM the container —
 * a content-level amplification bomb that no byte-size limit can catch.
 *
 * MAX_QTY_PER_ROW: nobody legitimately owns >2000 copies of one card (a
 * playset is 4; even bulk basics top out in the hundreds).
 * MAX_TOTAL_CARDS: ~90k unique printings exist in all of Magic; the largest
 * realistic single collection is well under 200k physical cards.
 */
export const MAX_QTY_PER_ROW = 2000;
export const MAX_TOTAL_CARDS = 200_000;

export class ImportTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportTooLargeError';
  }
}

/** Expands rows into one entry per physical copy, clamped to the import caps. */
export function expandByQuantity(rows: ImportRow[]): ImportRow[] {
  const expanded: ImportRow[] = [];
  for (const row of rows) {
    const qty = Math.min(MAX_QTY_PER_ROW, Math.max(1, row.quantity || 1));
    for (let i = 0; i < qty; i++) {
      if (expanded.length >= MAX_TOTAL_CARDS) {
        throw new ImportTooLargeError(
          `Import exceeds the ${MAX_TOTAL_CARDS.toLocaleString()}-card limit. ` +
            `Split it into smaller files.`
        );
      }
      expanded.push(row);
    }
  }
  return expanded;
}
