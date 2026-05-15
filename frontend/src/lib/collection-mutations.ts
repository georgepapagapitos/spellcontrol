import type { EnrichedCard } from '../types';

/**
 * Stable key for a printing + finish — the same grouping the collection table
 * uses to roll duplicate copies into one row. `finish` may be absent on older
 * data, so fall back to the foil flag.
 */
export function printingFinishKey(c: Pick<EnrichedCard, 'scryfallId' | 'finish' | 'foil'>): string {
  return `${c.scryfallId}:${c.finish ?? (c.foil ? 'foil' : 'nonfoil')}`;
}

export interface RemoveCopiesResult {
  /** The collection with the chosen copies removed. */
  next: EnrichedCard[];
  /** The exact copies that were removed (copyIds preserved, for undo). */
  removed: EnrichedCard[];
}

/**
 * Remove up to `count` physical copies of a single printing+finish from the
 * collection.
 *
 * Unallocated copies are dropped before allocated ones so that, when the user
 * owns spares, deleting some doesn't needlessly break a deck's binding.
 * `replaceAllCards` re-runs `remapAllocations` afterwards regardless, so any
 * binding that *is* broken self-heals to "unowned" — this just avoids
 * pointless churn when it's avoidable.
 */
export function removeCopiesOfPrinting(
  allCards: EnrichedCard[],
  key: string,
  count: number,
  allocatedCopyIds: ReadonlySet<string>
): RemoveCopiesResult {
  const matching = allCards.filter((c) => printingFinishKey(c) === key);
  const n = Math.max(0, Math.min(count, matching.length));
  if (n === 0) return { next: allCards, removed: [] };

  const ordered = [...matching].sort(
    (a, b) => (allocatedCopyIds.has(a.copyId) ? 1 : 0) - (allocatedCopyIds.has(b.copyId) ? 1 : 0)
  );
  const removed = ordered.slice(0, n);
  const removedIds = new Set(removed.map((c) => c.copyId));
  const next = allCards.filter((c) => !removedIds.has(c.copyId));
  return { next, removed };
}
