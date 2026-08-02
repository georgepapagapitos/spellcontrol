import type { FriendCard } from './cube/pool';

/** WUBRG identity codes plus 'C' for colorless. */
export type FriendColorFilter = ReadonlySet<string>;

function colorMatches(card: FriendCard, colors: FriendColorFilter): boolean {
  if (colors.size === 0) return true;
  if (card.colors.length === 0) return colors.has('C');
  return card.colors.some((c) => colors.has(c));
}

export interface FriendCollectionFilters {
  query: string;
  colors: FriendColorFilter;
}

/**
 * Pure filter + sort for the friend-collection browser (FriendHubPage). Name
 * search is a case-insensitive substring match; color is "any selected color
 * present", with an empty `colors` array on the card meaning colorless —
 * same semantics as the authed collection's color-filter row (see
 * lib/shared-filter.ts's `colorMatches`, which this mirrors at a smaller
 * scale since `FriendCard` carries far fewer fields than `EnrichedCard`).
 *
 * Default sort is EDHREC rank ascending (undefined ranks sort last, so
 * unranked cards don't crowd out the recognizable ones), tie-broken by name.
 * Runs over the FULL card list every call — callers cap how much of the
 * result they render, never how much they filter over.
 */
export function filterFriendCollection(
  cards: readonly FriendCard[],
  filters: FriendCollectionFilters
): FriendCard[] {
  const q = filters.query.trim().toLowerCase();
  return cards
    .filter(
      (c) => (q === '' || c.name.toLowerCase().includes(q)) && colorMatches(c, filters.colors)
    )
    .sort((a, b) => {
      const ar = a.edhrecRank ?? Number.POSITIVE_INFINITY;
      const br = b.edhrecRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
}
