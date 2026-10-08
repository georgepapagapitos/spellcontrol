import { getScryfallCache } from '../scryfall-cache';

/**
 * The EDHREC rank a surface shows: the one stored on the card row, else the one
 * on the cached Scryfall printing. Friend and profile collections both resolve
 * through this so Popularity sorts the same on either.
 */
export function edhrecRankOf(
  stored: unknown,
  cached: { edhrec_rank?: unknown } | undefined
): number | undefined {
  if (typeof stored === 'number') return stored;
  return typeof cached?.edhrec_rank === 'number' ? cached.edhrec_rank : undefined;
}

/**
 * Cached Scryfall printings for just the rows that lack a stored rank: one
 * batched, cache-only read (never a Scryfall request), so a 12k-card collection
 * pays for its gaps and nothing else.
 */
export function cachedPrintingsForMissingRanks(
  rows: Array<Record<string, unknown>>
): Map<string, { edhrec_rank?: unknown }> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (typeof r.edhrecRank !== 'number' && typeof r.scryfallId === 'string' && r.scryfallId) {
      ids.add(r.scryfallId);
    }
  }
  return ids.size > 0 ? getScryfallCache().getMany([...ids]) : new Map();
}
