// Pure helpers for refresh-sld-drops.mjs: resolve the booster `pack` codes that
// MTGJSON's sealed-content data uses to name bonus/chase cards, and give each
// resolved card to exactly ONE drop. No network, no fs.
//
// Why: a product lists `pack: [{ code: 'bonus-...' }]` instead of collector
// numbers. The code names a sheet in the compiled set's `booster` table, and
// some sheets are a whole pool shared by many drops (the twelve Astrology packs
// each list the same ~45 cards), so crediting every referencing drop put one
// card in up to 47 drops. A physical card was printed for one drop: the one
// whose date is closest to the printing's own released_at, the same rule the
// display layer applies (binder-routing pickClosestDrop).

const DAY_MS = 86_400_000;
const dayOf = (iso) => {
  const ms = Date.parse(iso ?? '');
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
};

/** Base collector number: "1627★" / "119a" → "1627" (matches sld-drop-dates.mjs). */
const baseNumber = (n) => String(n).replace(/[^0-9]+$/, '');

/**
 * Pack code → Set of collector numbers: every card on every sheet of that
 * booster, uuids resolved through the set's own card list.
 */
export function packNumbers(booster, numberByUuid) {
  const out = new Map();
  for (const [code, entry] of Object.entries(booster ?? {})) {
    const numbers = new Set();
    for (const sheet of Object.values(entry?.sheets ?? {})) {
      for (const uuid of Object.keys(sheet?.cards ?? {})) {
        const number = numberByUuid.get(uuid);
        if (number) numbers.add(number);
      }
    }
    out.set(code, numbers);
  }
  return out;
}

/**
 * Give every pack-listed card to one drop.
 *
 * @param packCodesByDrop  Map<drop name, Set<pack code>> from the products
 * @param numbersByPack    Map<pack code, Set<number>> from packNumbers()
 * @param dateByDrop       Map<drop name, 'YYYY-MM-DD'>
 * @param printings        [collector number, released_at][] from Scryfall
 * @param explicit         Set<number> already listed as an explicit card/deck
 *                         ref by some drop: those are never re-credited here.
 * @returns { assigned: Map<drop, Set<number>>, unmapped: [{ number, reason }] }
 *
 * Closest drop date to the printing's date wins (a number with several
 * printings uses the nearest one); a tie goes to the earliest drop that
 * references the card, then by name. A number with no printing date, or only
 * undated candidate drops, stays unmapped.
 */
export function assignPackNumbers({
  packCodesByDrop,
  numbersByPack,
  dateByDrop,
  printings,
  explicit,
}) {
  const printingDays = new Map();
  for (const [number, releasedAt] of printings) {
    const day = dayOf(releasedAt);
    if (day === null) continue;
    const key = baseNumber(number);
    const days = printingDays.get(key) ?? [];
    days.push(day);
    printingDays.set(key, days);
  }

  const candidates = new Map(); // number → Set<drop>
  for (const [drop, codes] of packCodesByDrop) {
    for (const code of codes) {
      for (const number of numbersByPack.get(code) ?? []) {
        if (explicit?.has(number)) continue;
        const set = candidates.get(number) ?? new Set();
        set.add(drop);
        candidates.set(number, set);
      }
    }
  }

  const assigned = new Map();
  const unmapped = [];
  for (const [number, drops] of candidates) {
    const days = printingDays.get(baseNumber(number));
    if (!days) {
      unmapped.push({ number, reason: 'no printing date' });
      continue;
    }
    let best = null;
    for (const drop of drops) {
      const date = dateByDrop.get(drop);
      const day = dayOf(date);
      if (day === null) continue;
      const gap = Math.min(...days.map((d) => Math.abs(day - d)));
      const better =
        !best ||
        gap < best.gap ||
        (gap === best.gap && (date < best.date || (date === best.date && drop < best.drop)));
      if (better) best = { drop, date, gap };
    }
    if (!best) {
      unmapped.push({ number, reason: 'no dated candidate drop' });
      continue;
    }
    const set = assigned.get(best.drop) ?? new Set();
    set.add(number);
    assigned.set(best.drop, set);
  }
  return { assigned, unmapped };
}
