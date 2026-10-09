// Pure helper for refresh-sld-drops.mjs: refuse a refresh that loses too much of
// the committed number -> drop map. No network, no fs.
//
// This used to also carry the committed membership forward when upstream stopped
// listing bonus cards by number. Pack codes are now resolved to one drop per card
// (sld-drop-packs.mjs), so a rebuild reproduces them on its own and a mapping
// upstream deliberately removes stays removed.

/** Largest share of the committed number/drop pairs a refresh may lose (after
 *  carry-forward and the date prune). Measured 2026-10: the legitimate churn
 *  of a refresh is the date-pruned misfilings, under 1% of ~2,400 pairs, so 2%
 *  (~49 pairs) leaves room for that and still stops a structural change, which
 *  loses hundreds. */
export const MAX_SHRINK_RATIO = 0.02;

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
