// Pure helpers for refresh-sld-drops.mjs: drop a number from a drop whose date
// cannot be the printing's own. No network, no fs.
//
// MTGJSON files some older bonus cards under a later drop (Ral, Storm Conduit
// SLD #523, released 2019-12-16, also sits under two 2021 drops), which
// mislabels a Release-date binder section. Scryfall's `released_at` per
// printing is the independent witness.
//
// Cutoff (a deviation from the drop's own median gap since the follow-up to
// #2754, which over-pruned whole consistently-offset drops), measured 2026-10 across every (printing, drop) pair: the drop date is
// normally 0-160 days AFTER the printing's released_at (Scryfall dates a
// wave's first day, MTGJSON a drop's own SKU; tail: Castle Dracula 158, City
// Styles 160). Past that the pairs are sparse and unrelated (175, 190, 213,
// 220, 233, 241, 265, ... up to 710). 170 sits in the empty stretch between
// 160 and 175. On the committed snapshot it removes 68 of 2,503 number/drop
// pairs; 17 numbers end up with no drop and no drop disappears.
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

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fewer dated members than this and a drop has no "normal" to deviate from. */
const MIN_DATED_MEMBERS = 3;

/** Offsets in this range (drop date minus printing date) are the normal wave lag. */
const PLAUSIBLE_GAP_DAYS = [-30, 170];

/**
 * The offset a drop's members agree on: the median of the biggest cluster of
 * gaps (members within `maxGapDays` of each other). A cluster inside the
 * plausible wave-lag range with at least three members beats a bigger
 * implausible one, because a misfiled bonus-card run (Culture Shocks lists the
 * 2020 planeswalker cards, more of them than its own lands) can outnumber the
 * drop's real cards. With no such cluster the biggest wins, which keeps a
 * consistently offset drop whole.
 */
function referenceGap(gapList, maxGapDays) {
  const clusters = gapList.map((g) => {
    const near = gapList.filter((h) => Math.abs(h - g) <= maxGapDays);
    return { size: near.length, mid: median(near) };
  });
  const plausible = clusters.filter(
    (c) =>
      c.mid >= PLAUSIBLE_GAP_DAYS[0] &&
      c.mid <= PLAUSIBLE_GAP_DAYS[1] &&
      c.size >= MIN_DATED_MEMBERS
  );
  const pool = plausible.length > 0 ? plausible : clusters;
  return pool.reduce((best, c) =>
    c.size > best.size || (c.size === best.size && Math.abs(c.mid) < Math.abs(best.mid)) ? c : best
  ).mid;
}

/**
 * Remove a number from a drop when it is an outlier RELATIVE TO ITS OWN DROP:
 * its signed gap (drop date minus nearest printing date) is more than
 * `maxGapDays` from the drop's reference offset (see `referenceGap`). A drop whose
 * members are all offset by about the same amount has a wrong date, not wrong
 * members (The Eyes Have It, Viva Las Rakdos, So Salty, Faerie Faerie Faerie
 * Rad), so it keeps every member; Ral #523 sits among drops whose other
 * members are near their dates, so it goes. Drops with fewer than three dated
 * members, numbers with no known printing date and drops with no date are left
 * alone. Drop dates are not rewritten.
 * Returns { drops, removed: [{ number, drop, gapDays }], offsetDrops } where
 * offsetDrops lists drops kept despite a median offset past the cutoff.
 */
export function pruneOutlierDrops(drops, printings, maxGapDays = MAX_DROP_GAP_DAYS) {
  const dates = printingDatesByNumber(printings);
  const removed = [];
  const offsetDrops = [];
  const out = [];
  for (const drop of drops) {
    const dropDay = drop.releasedAt ? dayOf(drop.releasedAt) : NaN;
    // Signed gap to the nearest printing of each dated member.
    const gaps = new Map();
    if (!Number.isNaN(dropDay)) {
      for (const number of drop.numbers) {
        const own = dates.get(baseNumber(number));
        if (!own) continue;
        const signed = [...own].map((d) => dropDay - dayOf(d));
        gaps.set(
          number,
          signed.reduce((best, g) => (Math.abs(g) < Math.abs(best) ? g : best))
        );
      }
    }
    let numbers = drop.numbers;
    if (gaps.size >= MIN_DATED_MEMBERS) {
      const mid = referenceGap([...gaps.values()], maxGapDays);
      if (Math.abs(mid) > maxGapDays) {
        offsetDrops.push({ drop: drop.name, medianGapDays: Math.round(mid), members: gaps.size });
      }
      numbers = drop.numbers.filter((number) => {
        const gap = gaps.get(number);
        if (gap === undefined || Math.abs(gap - mid) <= maxGapDays) return true;
        removed.push({ number, drop: drop.name, gapDays: Math.round(gap) });
        return false;
      });
    }
    if (numbers.length > 0) out.push({ ...drop, numbers });
  }
  return { drops: out, removed, offsetDrops };
}
