import type { ComboMatch, ComboMatchResponse, ComboSummary } from '@/types/combos';
import { getCombosByIds, iterateComboPages } from './db';
import { formatBit, getComboIndex } from './combo-index';
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
  // The scan runs over the compact index (combo-index.ts) — ids, interned
  // card numbers, popularity and legality bits — never over the full rows.
  // Only the rows that will be returned are read back from the store.
  const { index, lookup } = await getComboIndex();
  const owned = toCardSet(opts.ownedOracleIds, lookup);
  const inDeckSet = opts.deckOracleIds ? toCardSet(opts.deckOracleIds, lookup) : null;
  // A format the dataset does not know is legal for nothing — the same answer
  // the row-by-row check (`legalities[format] !== 'legal'`) always gave.
  const bit = opts.format ? formatBit(opts.format) : 0;
  if (opts.format && bit === 0) {
    return { inDeck: [], oneAway: [], almostInCollection: [], almostInCollectionTotal: 0 };
  }

  type Hit = { slot: number; present: string[]; missing: string[] };
  const inDeck: Hit[] = [];
  const oneAway: Hit[] = [];
  const almostInCollection: Hit[] = [];

  const { offsets, cards, legal, cardIds } = index;
  for (let slot = 0; slot < index.count; slot++) {
    if (bit && (legal[slot] & bit) === 0) continue;
    const from = offsets[slot];
    const to = offsets[slot + 1];
    if (to === from) continue;

    const have = inDeckSet ?? owned;
    let missingCount = 0;
    for (let k = from; k < to; k++) if (!have.has(cards[k])) missingCount++;
    if (missingCount > 1) continue;

    const present: string[] = [];
    const missing: string[] = [];
    for (let k = from; k < to; k++) {
      (have.has(cards[k]) ? present : missing).push(cardIds[cards[k]]);
    }
    const hit = { slot, present, missing };
    if (inDeckSet) (missingCount === 0 ? inDeck : oneAway).push(hit);
    else (missingCount === 0 ? inDeck : almostInCollection).push(hit);
  }

  const byPopularity = (a: Hit, b: Hit) => index.popularity[b.slot] - index.popularity[a.slot];
  inDeck.sort(byPopularity);
  oneAway.sort(byPopularity);
  almostInCollection.sort(byPopularity);
  const almostShown = almostInCollection.slice(0, ALMOST_LIMIT);

  const rows = await getCombosByIds(
    [...inDeck, ...oneAway, ...almostShown].map((h) => index.ids[h.slot])
  );
  const hydrate = (hits: Hit[]): ComboMatch[] => {
    const out: ComboMatch[] = [];
    for (const h of hits) {
      const row = rows.get(index.ids[h.slot]);
      if (row)
        out.push({
          combo: toSummary(row),
          presentOracleIds: h.present,
          missingOracleIds: h.missing,
        });
    }
    return out;
  };

  return {
    inDeck: hydrate(inDeck),
    oneAway: hydrate(oneAway),
    almostInCollection: hydrate(almostShown),
    almostInCollectionTotal: almostInCollection.length,
  };
}

/** Query ids as interned card numbers; ids no combo uses simply never match. */
function toCardSet(ids: Iterable<string>, lookup: Map<string, number>): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    const n = lookup.get(id);
    if (n !== undefined) out.add(n);
  }
  return out;
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

  const owned = toSet(opts.ownedOracleIds);
  const hits: ComboMatch[] = [];

  for await (const page of iterateComboPages())
    for (const combo of page) {
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
    bracketTag: c.bracketTag ?? null,
    templates: c.templates ?? null,
    templateQueries: c.templateQueries ?? null,
    cards: c.cards.map((cc) => ({
      oracleId: cc.oracleId,
      cardName: cc.cardName,
      quantity: cc.quantity,
    })),
  };
}
