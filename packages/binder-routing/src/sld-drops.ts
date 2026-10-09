/**
 * Which Secret Lair drop a printing belongs to when one collector number was
 * sold in several (a re-run, or a number reused across drops). Scryfall files
 * every Secret Lair under the flat `SLD` set, so the only evidence is the
 * printing's own release date: the candidate drop dated closest to it wins.
 *
 * Pure and shared so the live binder view (frontend) and the shared-binder
 * projection (backend) cannot pick differently. Callers pass candidates in
 * snapshot order (newest first); that order breaks ties and is the fallback
 * when the printing's date is unknown, so an undated card keeps the previous
 * "newest drop" rule.
 */

const DAY_MS = 86_400_000;

function dayOf(date: string | undefined): number | null {
  if (!date) return null;
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
}

export function pickClosestDrop<D extends { releasedAt: string }>(
  candidates: readonly D[],
  printingReleasedAt: string | undefined
): D | undefined {
  if (candidates.length < 2) return candidates[0];
  const target = dayOf(printingReleasedAt);
  if (target === null) return candidates[0];
  let best: D | undefined;
  let bestGap = Infinity;
  for (const drop of candidates) {
    const day = dayOf(drop.releasedAt);
    if (day === null) continue;
    const gap = Math.abs(day - target);
    if (gap < bestGap) {
      best = drop;
      bestGap = gap;
    }
  }
  // Every candidate undated: nothing to compare, keep the newest-first head.
  return best ?? candidates[0];
}
