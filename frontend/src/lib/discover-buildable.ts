/**
 * Client-side "percent buildable from your collection" for a Discover deck —
 * pure oracle-id set membership, never sent to the server (`sort=buildable`
 * is a client-only value; see `w2-discover-filters-sort`). `cardOracleIds`
 * (from `DiscoverDeck.cardOracleIds`) is already a distinct-id set built
 * server-side (`backend/src/discover/hydrate.ts`'s `priceDeck`), so this is a
 * plain "how many of the deck's distinct cards do you own" ratio — it
 * doesn't weight by copy count (e.g. basic lands), which is an accepted v1
 * simplification, not a bug.
 */
export function computeBuildablePercent(
  cardOracleIds: string[],
  ownedOracleIds: Set<string>
): number {
  if (cardOracleIds.length === 0) return 0;
  let owned = 0;
  for (const id of cardOracleIds) {
    if (ownedOracleIds.has(id)) owned++;
  }
  return Math.round((owned / cardOracleIds.length) * 100);
}
