import { getPool } from '../db';
import { getScryfallCache, pickUsdForFinish } from '../scryfall-cache';
import { asRecord, asString, projectDeck, type PublicDeck } from '../shares/projections';
import type { ScryfallCard } from '../types';

/**
 * Batch-hydrates a page of `deck_publications` listing rows with live
 * `user_decks` content: card-level oracle ids + a cache-only USD price
 * estimate. Card-level data was never denormalized onto `deck_publications`,
 * so this is the one place `w2-discover-listing-api` reads `user_decks.data`
 * — a targeted `WHERE (user_id, id) IN (...)` read of exactly the rows the
 * caller already selected from `deck_publications` by primary key, never a
 * filter/sort predicate over the JSONB (the PR's folded "no JSONB scans"
 * fix). Every hit runs through the existing `projectDeck()` rather than
 * re-parsing the deck shape — zero new deck-shape code, per the whole social
 * program's own rule.
 */

export interface PublicationListingRow {
  userId: string;
  deckId: string;
  slug: string;
  name: string;
  ownerUsername: string;
  format: string;
  commanderName: string | null;
  colorIdentity: string[];
  bracket: number | null;
  viewCount: number;
  copyCount: number;
  publishedAt: number;
}

export interface DiscoverDeckSummary {
  slug: string;
  name: string;
  ownerUsername: string;
  format: string;
  commanderName: string | null;
  colorIdentity: string[];
  bracket: number | null;
  estimatedValueUsd: number | null;
  viewCount: number;
  copyCount: number;
  publishedAt: number;
  cardOracleIds: string[];
}

/**
 * Every raw card object that counts toward a deck's price / oracle-id set:
 * the commander(s) plus the mainboard. Sideboard is deliberately excluded —
 * it's not part of what the deck actually costs to assemble, and the spec's
 * own enumeration of hydration sources (`cards[]`/`commander`/
 * `partnerCommander`) never mentions it.
 */
function pricedCardsOf(deck: PublicDeck): unknown[] {
  const out: unknown[] = [];
  if (deck.commander) out.push(deck.commander);
  if (deck.partnerCommander) out.push(deck.partnerCommander);
  for (const slot of deck.cards) out.push(slot.card);
  return out;
}

/**
 * A deck card is the raw embedded ScryfallCard-shaped object (snake_case
 * `id`/`oracle_id`) — `projectDeck` passes it through unprojected, since a
 * decklist entry is not an owned physical copy (no `PublicCard` camelCase
 * shape applies here).
 */
function cardIds(raw: unknown): { scryfallId?: string; oracleId?: string } {
  const r = asRecord(raw);
  return r ? { scryfallId: asString(r.id), oracleId: asString(r.oracle_id) } : {};
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sums cache-only USD value across a deck's priced cards. `estimatedValueUsd`
 * is `null` — not `$0`, not a partial sum — the moment any priced card's
 * scryfallId misses the Scryfall cache, so a budget filter never misfiles an
 * unpriced deck into `<$50` (folded blocking fix). Deck cards carry no
 * `finish` (a decklist entry isn't an owned physical copy), so pricing uses
 * `pickUsdForFinish`'s default nonfoil-first ordering.
 */
function priceDeck(
  deck: PublicDeck,
  cached: Map<string, ScryfallCard>
): { oracleIds: string[]; estimatedValueUsd: number | null } {
  const oracleIds = new Set<string>();
  let total = 0;
  let allPriced = true;
  for (const raw of pricedCardsOf(deck)) {
    const { scryfallId, oracleId } = cardIds(raw);
    if (oracleId) oracleIds.add(oracleId);
    const sc = scryfallId ? cached.get(scryfallId) : undefined;
    if (!sc) {
      allPriced = false;
      continue;
    }
    total += pickUsdForFinish(sc);
  }
  return { oracleIds: [...oracleIds], estimatedValueUsd: allPriced ? round2(total) : null };
}

export async function hydratePublicationRows(
  rows: PublicationListingRow[]
): Promise<DiscoverDeckSummary[]> {
  if (rows.length === 0) return [];

  const pool = getPool();
  const placeholders = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const { rows: deckRows } = await pool.query<{ user_id: string; id: string; data: unknown }>(
    `SELECT user_id, id, data FROM user_decks WHERE (user_id, id) IN (${placeholders})`,
    rows.flatMap((r) => [r.userId, r.deckId])
  );
  const dataByKey = new Map(deckRows.map((r) => [`${r.user_id}:${r.id}`, r.data]));

  // Defensive: a publication row surviving a race past its own deck's
  // tombstone (same race routes/public.ts guards against for a single-deck
  // read). A listing page has no single-item stealth requirement, so this
  // just surfaces the publication with no oracle ids and no price rather
  // than dropping it or 500ing the whole page.
  const projected = rows.map((row) => {
    const data = dataByKey.get(`${row.userId}:${row.deckId}`);
    const deck =
      data == null ? null : projectDeck({ username: row.ownerUsername, displayName: null }, data);
    return { row, deck };
  });

  const allScryfallIds = new Set<string>();
  for (const { deck } of projected) {
    if (!deck) continue;
    for (const raw of pricedCardsOf(deck)) {
      const { scryfallId } = cardIds(raw);
      if (scryfallId) allScryfallIds.add(scryfallId);
    }
  }
  const cached =
    allScryfallIds.size > 0 ? getScryfallCache().getMany([...allScryfallIds]) : new Map();

  return projected.map(({ row, deck }) => {
    const { oracleIds, estimatedValueUsd } = deck
      ? priceDeck(deck, cached)
      : { oracleIds: [] as string[], estimatedValueUsd: null };
    return {
      slug: row.slug,
      name: row.name,
      ownerUsername: row.ownerUsername,
      format: row.format,
      commanderName: row.commanderName,
      colorIdentity: row.colorIdentity,
      bracket: row.bracket,
      estimatedValueUsd,
      viewCount: row.viewCount,
      copyCount: row.copyCount,
      publishedAt: row.publishedAt,
      cardOracleIds: oracleIds,
    };
  });
}
