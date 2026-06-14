/**
 * Price-freshness helpers. Card prices are device-local and refreshed on a
 * daily on-stale cadence; these surface "when was this priced" on demand
 * (card preview + Settings) now that the always-on "Prices as of" hero line is
 * gone. Pure + tiny so both call sites format the date identically.
 */

/** "Updated Jun 14, 2026" from a price timestamp; null when never priced. */
export function formatPricedDate(pricedAt: number | null | undefined): string | null {
  if (pricedAt == null || pricedAt <= 0) return null;
  return new Date(pricedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Newest price stamp across a set of cards (the collection's freshness), or
 *  null if nothing has ever been priced. */
export function newestPricedAt(cards: ReadonlyArray<{ pricedAt?: number }>): number | null {
  let newest = 0;
  for (const c of cards) {
    if (c.pricedAt != null && c.pricedAt > newest) newest = c.pricedAt;
  }
  return newest > 0 ? newest : null;
}
