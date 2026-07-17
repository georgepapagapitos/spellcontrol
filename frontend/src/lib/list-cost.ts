import type { EnrichedCard, ListEntry } from '../types';
import { ownedCountForEntry } from './lists';

export interface ListCostSummary {
  /** USD cost to buy every unowned copy across the list (excludes entries with no resolvable price). */
  totalCost: number;
  /** Count of entries with at least one unowned copy but no resolvable price — never silently $0. */
  unpricedCount: number;
  /** Entries whose quantity isn't fully covered by owned copies (tracking lists surface this as drift). */
  unownedEntries: number;
  /** True once every entry's quantity is already covered by owned copies (false for an empty list). */
  allOwned: boolean;
}

/**
 * Rolls a list's resolved rows into a shopping-plan total: sum of
 * `card.purchasePrice * (quantity - owned)` over entries with any shortfall,
 * skipping unpriced entries into a separate count rather than treating them
 * as free. Pure — same `ownedCountForEntry` match (oracleId, else name) the
 * per-row "own it" indicator uses, so the two never disagree.
 */
export function summarizeListCost(
  rows: Array<{ entry: ListEntry; card: EnrichedCard }>,
  owned: EnrichedCard[]
): ListCostSummary {
  let totalCost = 0;
  let unpricedCount = 0;
  let unownedEntries = 0;

  for (const { entry, card } of rows) {
    const shortfall = Math.max(0, entry.quantity - ownedCountForEntry(entry, owned));
    if (shortfall === 0) continue;
    unownedEntries += 1;
    if (card.purchasePrice > 0) totalCost += card.purchasePrice * shortfall;
    else unpricedCount += 1;
  }

  return {
    totalCost,
    unpricedCount,
    unownedEntries,
    allOwned: rows.length > 0 && unownedEntries === 0,
  };
}
