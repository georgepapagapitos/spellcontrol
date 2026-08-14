import type { FriendCard } from './cube/pool';
import { colorSelectionMatches, type ColorMatchMode } from './colors';
import { buildFriendSearch } from './friend-search';

/** WUBRG identity codes plus 'C' for colorless. */
export type FriendColorFilter = ReadonlySet<string>;

function colorMatches(card: FriendCard, colors: FriendColorFilter, mode: ColorMatchMode): boolean {
  return colorSelectionMatches(card.colors.length === 0 ? 'C' : '', card.colors, colors, mode);
}

export interface FriendCollectionFilters {
  query: string;
  colors: FriendColorFilter;
  /** OR ('any', default) vs AND ('all') across the selected colors. */
  colorMode?: ColorMatchMode;
  /** Oracle-tag lookup, so `otag:` clauses resolve (keyed by card NAME). */
  tagsFor?: (name: string) => string[];
}

export interface FriendCollectionResult {
  cards: FriendCard[];
  /** Clause labels the friend payload can't answer — surface these (E237). */
  ignored: string[];
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
): FriendCollectionResult {
  // Plain text stays a name substring; operator syntax (t:, ci:, cmc<=, otag:…)
  // routes through the shared Scryfall interpreter. `ignored` names any clause
  // the thin friend payload can't answer, so the caller can say so rather than
  // rendering an empty list as "they own none" (E237).
  const search = buildFriendSearch(filters.query, filters.tagsFor);
  const cardsOut = cards
    .filter((c) => search.match(c) && colorMatches(c, filters.colors, filters.colorMode ?? 'any'))
    .sort((a, b) => {
      const ar = a.edhrecRank ?? Number.POSITIVE_INFINITY;
      const br = b.edhrecRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
  return { cards: cardsOut, ignored: search.ignored };
}
