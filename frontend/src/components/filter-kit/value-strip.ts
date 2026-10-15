/**
 * The chips' value: the exact values picked, plus `atLeast` for the open top
 * end. `{ values: [2, 3] }` is "2 or 3"; the top chip unnarrowed is
 * `{ values: [], atLeast: 7 }` (7 and up); `{ values: [9] }` is exactly 9;
 * `{ values: [2], atLeast: 13 }` is 2, or 13 and up. Empty (`{ values: [] }`)
 * is no filter. Matches the engine's planned `manaValues` field.
 */
export interface ValueStripChips {
  values: number[];
  atLeast?: number;
}

/**
 * Custom…'s value: a comparator. At least n is `{ min: n }`, at most n is
 * `{ max: n }`, exactly n is `{ min: n, max: n }`, between is both.
 */
export interface ValueStripRange {
  min?: number;
  max?: number;
}

/** Either shape. A value with a `values` key is the chips; anything else is Custom…. */
export type ValueStripValue = ValueStripChips | ValueStripRange;

export const EMPTY_VALUE_STRIP: ValueStripChips = { values: [] };

export function isValueStripRange(v: ValueStripValue): v is ValueStripRange {
  return !('values' in v);
}

/** How many values are on, for the section's count: each chip, or 1 for a range. */
export function valueStripCount(v: ValueStripValue): number {
  if (isValueStripRange(v)) return v.min !== undefined || v.max !== undefined ? 1 : 0;
  return v.values.length + (v.atLeast !== undefined ? 1 : 0);
}
