// Pure helpers for refresh-sld-drops.mjs: keep the committed snapshot's
// number -> drop membership when upstream changes how it writes it down, and
// refuse a refresh that loses too much. No network, no fs.
//
// Why: MTGJSON's sealed-content data now names many bonus/chase cards by
// booster `pack` code instead of listing collector numbers. Resolving packs
// over-credits (a pool card lands in up to 47 drops), so the script cannot read
// those memberships back, and a plain rebuild silently strips ~200 drop labels.

/** Largest share of the committed number/drop pairs a refresh may lose (after
 *  carry-forward and the date prune). Measured 2026-10: the legitimate churn
 *  of a refresh is the date-pruned misfilings, under 1% of ~2,400 pairs, so 2%
 *  (~49 pairs) leaves room for that and still stops a structural change, which
 *  loses hundreds. */
export const MAX_SHRINK_RATIO = 0.02;

const byNumber = (a, b) => Number(a) - Number(b) || a.localeCompare(b);

/**
 * Union the previous snapshot's membership into the freshly built drops.
 * A previous drop absent from `built` is kept whole; a present one gains any
 * previous number upstream no longer lists. Dates come from the new build when
 * it has one, else the previous. Returns { drops, carried } where carried is
 * [{ drop, number }] for every pair that came only from the snapshot.
 */
export function carryForward(built, previous) {
  const byName = new Map(built.map((d) => [d.name, { ...d, numbers: [...d.numbers] }]));
  const carried = [];
  for (const prev of previous ?? []) {
    const cur = byName.get(prev.name);
    if (!cur) {
      byName.set(prev.name, { ...prev, numbers: [...prev.numbers] });
      for (const number of prev.numbers) carried.push({ drop: prev.name, number });
      continue;
    }
    const have = new Set(cur.numbers);
    for (const number of prev.numbers) {
      if (have.has(number)) continue;
      cur.numbers.push(number);
      carried.push({ drop: prev.name, number });
    }
    cur.numbers.sort(byNumber);
    if (!cur.releasedAt && prev.releasedAt) cur.releasedAt = prev.releasedAt;
  }
  const drops = [...byName.values()].sort(
    (a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name)
  );
  return { drops, carried };
}

const pairKeys = (drops) => new Set(drops.flatMap((d) => d.numbers.map((n) => `${d.name}\t${n}`)));

/**
 * Throw when `next` lost more than `maxRatio` of `previous`'s number/drop pairs.
 * Returns { before, lost } otherwise. Gains are not netted against losses: a
 * refresh that swaps 100 pairs for 100 others still rewrote the map.
 */
export function assertNoShrink(next, previous, maxRatio = MAX_SHRINK_RATIO) {
  const before = pairKeys(previous ?? []);
  if (before.size === 0) return { before: 0, lost: [] };
  const after = pairKeys(next);
  const lost = [...before].filter((k) => !after.has(k));
  if (lost.length > before.size * maxRatio) {
    const sample = lost
      .slice(0, 5)
      .map((k) => k.replace('\t', ' #'))
      .join(', ');
    throw new Error(
      `Secret Lair drop map lost ${lost.length} of ${before.size} number/drop pairs ` +
        `(limit ${(maxRatio * 100).toFixed(0)}%), e.g. ${sample}. ` +
        'Suspect an upstream format change. Re-run with --allow-shrink to write anyway.'
    );
  }
  return { before: before.size, lost };
}
