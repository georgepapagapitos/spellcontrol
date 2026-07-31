import type { ComboMatch, ComboMatchResponse, ComboSummary } from '@/types/combos';
import { getAllCombos } from './db';
import type { OfflineCombo } from './types';

/**
 * Local port of backend `combos/match.ts:matchCombos()` — identical bucketing
 * logic so the offline UI sees the same shape it would over the wire.
 */
const ALMOST_LIMIT = 200;

export async function matchCombosLocal(opts: {
  ownedOracleIds: Iterable<string>;
  deckOracleIds?: Iterable<string>;
  format?: string;
}): Promise<Omit<ComboMatchResponse, 'source'>> {
  const all = await getAllCombos();
  const owned = toSet(opts.ownedOracleIds);
  const inDeckSet = opts.deckOracleIds ? toSet(opts.deckOracleIds) : null;

  const inDeck: ComboMatch[] = [];
  const oneAway: ComboMatch[] = [];
  const almostInCollection: ComboMatch[] = [];

  for (const combo of all) {
    if (opts.format && combo.legalities[opts.format] !== 'legal') continue;
    if (combo.cards.length === 0) continue;

    const present: string[] = [];
    const missing: string[] = [];

    if (inDeckSet) {
      for (const card of combo.cards) {
        (inDeckSet.has(card.oracleId) ? present : missing).push(card.oracleId);
      }
      if (missing.length === 0) {
        inDeck.push({
          combo: toSummary(combo),
          presentOracleIds: present,
          missingOracleIds: [],
        });
        continue;
      }
      if (missing.length === 1) {
        oneAway.push({
          combo: toSummary(combo),
          presentOracleIds: present,
          missingOracleIds: missing,
        });
      }
      continue;
    }

    for (const card of combo.cards) {
      (owned.has(card.oracleId) ? present : missing).push(card.oracleId);
    }
    if (missing.length === 0) {
      inDeck.push({
        combo: toSummary(combo),
        presentOracleIds: present,
        missingOracleIds: [],
      });
    } else if (missing.length === 1) {
      almostInCollection.push({
        combo: toSummary(combo),
        presentOracleIds: present,
        missingOracleIds: missing,
      });
    }
  }

  const byPopularity = (a: ComboMatch, b: ComboMatch) => b.combo.popularity - a.combo.popularity;
  inDeck.sort(byPopularity);
  oneAway.sort(byPopularity);
  almostInCollection.sort(byPopularity);

  return {
    inDeck,
    oneAway,
    almostInCollection: almostInCollection.slice(0, ALMOST_LIMIT),
    almostInCollectionTotal: almostInCollection.length,
  };
}

/**
 * Cap on returned search rows. The scan itself covers every combo, so `total`
 * is the honest count — only the rendered slice is bounded.
 */
const SEARCH_LIMIT = 200;

export interface ComboSearchResult {
  matches: ComboMatch[];
  /** True number of hits before SEARCH_LIMIT, so the UI can disclose the cap. */
  total: number;
}

/**
 * E216: search the WHOLE local combo dataset, not the buckets that
 * `matchCombosLocal` already returned.
 *
 * The page's search used to filter the matcher's output, which is both capped
 * (ALMOST_LIMIT) and bucketed into "own everything" / "own all but one". So
 * searching for a card found it only if one of its combos was already popular
 * enough to survive the cap — and combos you own 1-of-3 of were unreachable at
 * any cap, because they have no bucket at all.
 *
 * Matching mirrors `combo-filters.ts:matchesSearch` (card names AND result
 * text) so "infinite mana" style queries keep working and card-name search
 * falls out of it. The predicate runs against the RAW rows so a 102k-row scan
 * doesn't materialize a ComboSummary per miss.
 *
 * Ordering is closest-first — fewest missing pieces, then most popular. On this
 * surface "how close am I?" is the question, so distance is the sort key.
 */
export async function searchCombosLocal(opts: {
  query: string;
  ownedOracleIds: Iterable<string>;
  format?: string;
}): Promise<ComboSearchResult> {
  const needle = opts.query.trim().toLowerCase();
  if (!needle) return { matches: [], total: 0 };

  const all = await getAllCombos();
  const owned = toSet(opts.ownedOracleIds);
  const hits: ComboMatch[] = [];

  for (const combo of all) {
    if (opts.format && combo.legalities[opts.format] !== 'legal') continue;
    if (combo.cards.length === 0) continue;
    if (!rawMatchesSearch(combo, needle)) continue;

    const present: string[] = [];
    const missing: string[] = [];
    for (const card of combo.cards) {
      (owned.has(card.oracleId) ? present : missing).push(card.oracleId);
    }
    hits.push({ combo: toSummary(combo), presentOracleIds: present, missingOracleIds: missing });
  }

  hits.sort((a, b) => {
    const d = a.missingOracleIds.length - b.missingOracleIds.length;
    return d !== 0 ? d : b.combo.popularity - a.combo.popularity;
  });

  return { matches: hits.slice(0, SEARCH_LIMIT), total: hits.length };
}

/** Same fields as `combo-filters.ts:matchesSearch`, against a raw row. */
function rawMatchesSearch(combo: OfflineCombo, needle: string): boolean {
  for (const c of combo.cards) {
    if (c.cardName.toLowerCase().includes(needle)) return true;
  }
  for (const p of combo.produces) {
    if (p.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function toSet(ids: Iterable<string>): Set<string> {
  return ids instanceof Set ? ids : new Set(ids);
}

function toSummary(c: OfflineCombo): ComboSummary {
  return {
    id: c.id,
    identity: c.identity,
    produces: c.produces,
    prerequisites: c.prerequisites,
    description: c.description,
    manaNeeded: c.manaNeeded,
    popularity: c.popularity,
    cardCount: c.cardCount,
    bracket: c.bracket,
    cards: c.cards.map((cc) => ({
      oracleId: cc.oracleId,
      cardName: cc.cardName,
      quantity: cc.quantity,
    })),
  };
}
