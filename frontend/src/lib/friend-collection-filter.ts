import type { FriendCard } from './cube/pool';
import type { PublicCard } from './shared-types';
import { colorSelectionMatches, type ColorMatchMode } from './colors';
import { buildFriendSearch, type FriendSearchCaps } from './friend-search';

/** WUBRG identity codes plus 'C' for colorless. */
export type FriendColorFilter = ReadonlySet<string>;

const EMPTY_COLORS: FriendColorFilter = new Set();

/**
 * Lift a friend card into the public-card shape the shared filter dialog
 * matches on (`useSharedFilters` → `makeSharedMatcher`). The friend payload is
 * public card FACTS only — name, type line, colours, mana value, rarity, and
 * (on an enriched payload) rules text and filterable-format legality. No
 * printing and no price: those fields are left empty and the dialog is
 * mounted with the `card-facts` facet set, which hides the rows they drive.
 */
export function friendCardToPublic(card: FriendCard): PublicCard {
  return {
    name: card.name,
    oracleId: card.oracleId,
    scryfallId: card.oracleId,
    setCode: '',
    setName: '',
    collectorNumber: '',
    rarity: card.rarity ?? '',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 0,
    cmc: card.cmc,
    typeLine: card.typeLine,
    colors: card.colors,
    colorIdentity: card.colorIdentity,
    oracleText: card.oracleText,
    legalities: card.legalities,
  };
}

/** Sort keys for the friend-collection browser; each pairs with a direction. */
export type FriendSortKey = 'popularity' | 'name' | 'cmc' | 'rarity';

const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

/**
 * Stable sort over an already-filtered list. Ascending popularity is
 * most-popular-first (EDHREC rank 1 is the top card); unranked cards sort
 * last in either direction so they never crowd out the recognisable ones.
 * Name breaks every tie so the order can't shuffle between renders.
 */
export function sortFriendCollection(
  cards: readonly FriendCard[],
  key: FriendSortKey,
  dir: 'asc' | 'desc'
): FriendCard[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: FriendCard, b: FriendCard) => a.name.localeCompare(b.name);
  return [...cards].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'popularity': {
        const ar = a.edhrecRank;
        const br = b.edhrecRank;
        if (ar === undefined || br === undefined) {
          // Unranked last regardless of direction.
          if (ar === undefined && br === undefined) return byName(a, b);
          return ar === undefined ? 1 : -1;
        }
        cmp = ar - br;
        break;
      }
      case 'name':
        cmp = byName(a, b);
        break;
      case 'cmc':
        cmp = a.cmc - b.cmc;
        break;
      case 'rarity':
        cmp = (RARITY_ORDER[a.rarity ?? ''] ?? -1) - (RARITY_ORDER[b.rarity ?? ''] ?? -1);
        break;
    }
    return cmp !== 0 ? cmp * sign : byName(a, b);
  });
}

function colorMatches(card: FriendCard, colors: FriendColorFilter, mode: ColorMatchMode): boolean {
  return colorSelectionMatches(card.colors.length === 0 ? 'C' : '', card.colors, colors, mode);
}

export interface FriendCollectionFilters {
  query: string;
  /** Color pips. Omitted when the caller filters color through
   *  `useSharedFilters` instead (FriendHubPage). */
  colors?: FriendColorFilter;
  /** OR ('any', default) vs AND ('all') across the selected colors. */
  colorMode?: ColorMatchMode;
  /** Oracle-tag lookup, so `otag:` clauses resolve (keyed by card NAME). */
  tagsFor?: (name: string) => string[];
  /** Which optional facts this payload carries — see `friendPayloadCaps`. */
  caps?: FriendSearchCaps;
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
  const search = buildFriendSearch(filters.query, filters.tagsFor, filters.caps);
  const colors = filters.colors ?? EMPTY_COLORS;
  const cardsOut = cards
    .filter((c) => search.match(c) && colorMatches(c, colors, filters.colorMode ?? 'any'))
    .sort((a, b) => {
      const ar = a.edhrecRank ?? Number.POSITIVE_INFINITY;
      const br = b.edhrecRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
  return { cards: cardsOut, ignored: search.ignored };
}
