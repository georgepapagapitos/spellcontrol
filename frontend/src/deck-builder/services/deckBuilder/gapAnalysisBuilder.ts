import type { EDHRECCard, EDHRECCommanderData, GapAnalysisCard } from '@/deck-builder/types';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { isBasicLandName } from '@/lib/allocations';

/** Default number of EDHREC-recommended cards to surface as "cards to consider". */
const DEFAULT_GAP_LIMIT = 30;

/** Display labels for functional roles (mirrors the generator's gap-analysis phase). */
const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

export interface BuildGapAnalysisOptions {
  /** Max number of suggestions to return (default 30). */
  limit?: number;
  /** Collection names — when provided, each suggestion is marked `isOwned`. */
  collectionNames?: Set<string>;
}

/** EDHREC ships TCGplayer/Cardkingdom prices; return the first available as a 2dp string. */
function edhrecPrice(card: EDHRECCard): string | null {
  if (card.prices?.tcgplayer?.price) return card.prices.tcgplayer.price.toFixed(2);
  if (card.prices?.cardkingdom?.price) return card.prices.cardkingdom.price.toFixed(2);
  return null;
}

function toNameSet(names: Set<string> | string[]): Set<string> {
  if (names instanceof Set) return names;
  return new Set(names);
}

/**
 * Build the "cards to consider" gap analysis for a commander deck: the top-N
 * EDHREC-recommended non-land cards that are NOT already in the deck, ranked by
 * inclusion %, each enriched with its functional role (from the tagger) and
 * `isOwned` when a collection is supplied.
 *
 * Pure and synchronous — all display data (price, image, cmc, type) comes from
 * the EDHREC card itself, so there's no Scryfall round-trip. Basic lands and
 * cards already in the deck are skipped; DFC front-face names are matched too.
 */
export function buildGapAnalysis(
  edhrecData: EDHRECCommanderData,
  deckCardNames: Set<string> | string[],
  opts: BuildGapAnalysisOptions = {}
): GapAnalysisCard[] {
  const { limit = DEFAULT_GAP_LIMIT, collectionNames } = opts;
  if (limit <= 0) return [];

  // Expand the deck's names with DFC front-face variants so EDHREC's
  // front-face-only names dedupe correctly against double-faced cards.
  const inDeck = new Set<string>();
  for (const name of toNameSet(deckCardNames)) {
    inDeck.add(name);
    if (name.includes(' // ')) inDeck.add(name.split(' // ')[0]);
  }

  return edhrecData.cardlists.allNonLand
    .filter((c) => !inDeck.has(c.name) && !isBasicLandName(c.name))
    .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0))
    .slice(0, limit)
    .map((c) => {
      const role = getCardRole(c.name) || undefined;
      return {
        name: c.name,
        price: edhrecPrice(c),
        inclusion: c.inclusion,
        synergy: c.synergy ?? 0,
        typeLine: c.primary_type ?? '',
        cmc: c.cmc,
        imageUrl: c.image_uris?.[0]?.normal,
        isOwned: collectionNames ? collectionNames.has(c.name) : undefined,
        role,
        roleLabel: role ? ROLE_LABELS[role] : undefined,
      } satisfies GapAnalysisCard;
    });
}
