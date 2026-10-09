// Pure helpers for refresh-sld-drops.mjs: drop a number from a drop whose date
// cannot be the printing's own. No network, no fs.
//
// MTGJSON files some older bonus cards under a later drop (Ral, Storm Conduit
// SLD #523, released 2019-12-16, also sits under two 2021 drops), which
// mislabels a Release-date binder section. Scryfall's `released_at` per
// printing is the independent witness.
//
// Cutoff, measured 2026-10 across every (printing, drop) pair: the drop date is
// normally 0-160 days AFTER the printing's released_at (Scryfall dates a
// wave's first day, MTGJSON a drop's own SKU; tail: Castle Dracula 158, City
// Styles 160). Past that the pairs are sparse and unrelated (175, 190, 213,
// 220, 233, 241, 265, ... up to 710). 170 sits in the empty stretch between
// 160 and 175. It removes 88 of 2,503 number/drop pairs; 39 numbers end up
// with no drop at all.
export const MAX_DROP_GAP_DAYS = 170;

const dayOf = (iso) => Date.parse(iso) / 86_400_000;

/** Base collector number: "1627★" / "119a" → "1627". */
const baseNumber = (n) => String(n).replace(/[^0-9]+$/, '');

/** Collector number (base) → every distinct released_at among its printings. */
export function printingDatesByNumber(printings) {
  const out = new Map();
  for (const [number, releasedAt] of printings) {
    if (!releasedAt) continue;
    const key = baseNumber(number);
    const set = out.get(key) ?? new Set();
    set.add(releasedAt);
    out.set(key, set);
  }
  return out;
}

/**
 * Remove each number from any drop whose date is more than `maxGapDays` from
 * EVERY printing of that number (a number with no known printing date, or a
 * drop with no date, is left alone). Drops left empty are dropped.
 * Returns { drops, removed: [{ number, drop, gapDays }] }.
 */
export function pruneOutlierDrops(drops, printings, maxGapDays = MAX_DROP_GAP_DAYS) {
  const dates = printingDatesByNumber(printings);
  const removed = [];
  const out = [];
  for (const drop of drops) {
    const dropDay = drop.releasedAt ? dayOf(drop.releasedAt) : NaN;
    const numbers = drop.numbers.filter((number) => {
      const own = dates.get(baseNumber(number));
      if (!own || Number.isNaN(dropDay)) return true;
      const gap = Math.min(...[...own].map((d) => Math.abs(dropDay - dayOf(d))));
      if (gap <= maxGapDays) return true;
      removed.push({ number, drop: drop.name, gapDays: Math.round(gap) });
      return false;
    });
    if (numbers.length > 0) out.push({ ...drop, numbers });
  }
  return { drops: out, removed };
}
