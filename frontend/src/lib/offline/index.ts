/**
 * Offline-mode public API.
 *
 * Higher-level wrappers around the IDB layer that return ScryfallCard-shaped
 * objects so the deck builder, card list views, and combo UI don't need to
 * know about SlimCard. When offline mode is disabled or no data is loaded,
 * callers fall back to the live Scryfall path.
 *
 * Why one entry point: import sites only need to ask "is offline available?"
 * and "give me a card / search / combo result." The internals (IDB, query
 * interpreter, slim/scryfall inflation) stay private.
 */

import type { ScryfallCard, ScryfallSearchResponse } from '@/deck-builder/types';
import {
  getCardByName as idbGetCardByName,
  getCardByOracleId as idbGetCardByOracleId,
  getCardsByOracleIds as idbGetCardsByOracleIds,
  iterateAllCards,
  readManifest,
} from './db';
import { matchesQuery, parseQuery } from './scryfall-query';
import { slimToScryfall } from './slim-to-scryfall';
import type { OfflineManifest, SlimCard } from './types';

export { syncOfflineData } from './download';
export type { DownloadPhase, DownloadProgress } from './download';
export { matchCombosLocal } from './match-combos';
export { clearOfflineData, getOfflineDataStats, readManifest as readOfflineManifest } from './db';
export type { OfflineManifest } from './types';

/** True when the IDB has at least one card AND a manifest is present. */
export async function offlineDataAvailable(): Promise<boolean> {
  const manifest = await readManifest();
  return !!manifest && manifest.oracleCardCount > 0;
}

export async function offlineGetManifest(): Promise<OfflineManifest | null> {
  return readManifest();
}

export async function offlineGetCardByName(name: string): Promise<ScryfallCard | null> {
  const slim = await idbGetCardByName(name);
  return slim ? slimToScryfall(slim) : null;
}

export async function offlineGetCardByOracleId(oracleId: string): Promise<ScryfallCard | null> {
  const slim = await idbGetCardByOracleId(oracleId);
  return slim ? slimToScryfall(slim) : null;
}

export async function offlineGetCardsByNames(names: string[]): Promise<Map<string, ScryfallCard>> {
  const out = new Map<string, ScryfallCard>();
  await Promise.all(
    names.map(async (name) => {
      const card = await offlineGetCardByName(name);
      if (card) out.set(name, card);
    })
  );
  return out;
}

export async function offlineGetCardsByOracleIds(
  oracleIds: string[]
): Promise<Map<string, ScryfallCard>> {
  const slims = await idbGetCardsByOracleIds(oracleIds);
  const out = new Map<string, ScryfallCard>();
  for (const [id, slim] of slims) out.set(id, slimToScryfall(slim));
  return out;
}

/**
 * Run a Scryfall-syntax query against the local oracle store. Mirrors the
 * shape returned by `searchCards()` so the deck builder can drop it in without
 * branching on response type. Pagination is fixed at 175 cards per page (the
 * Scryfall default) so consumers expecting `has_more` semantics work.
 */
export async function offlineSearchCards(
  rawQuery: string,
  opts: {
    colorIdentity?: string[];
    page?: number;
    order?: 'edhrec' | 'cmc' | 'name';
    skipFormatFilter?: boolean;
    skipColorFilter?: boolean;
  } = {}
): Promise<ScryfallSearchResponse> {
  const {
    colorIdentity = [],
    page = 1,
    order = 'edhrec',
    skipFormatFilter = false,
    skipColorFilter = false,
  } = opts;

  // Glue on the same color/format clauses the live searchCards() function adds.
  const colorClause =
    !skipColorFilter && colorIdentity.length > 0 ? `id<=${colorIdentity.join('')}` : '';
  const formatClause = skipFormatFilter ? '' : 'f:commander';
  const fullQuery = `${colorClause} (${rawQuery}) ${formatClause}`.trim();

  const parsed = parseQuery(fullQuery);
  const matches: SlimCard[] = [];
  for await (const card of iterateAllCards()) {
    if (matchesQuery(card, parsed)) matches.push(card);
  }

  matches.sort(cardComparator(order));

  const PAGE_SIZE = 175;
  const start = (page - 1) * PAGE_SIZE;
  const slice = matches.slice(start, start + PAGE_SIZE);
  return {
    object: 'list',
    total_cards: matches.length,
    has_more: start + PAGE_SIZE < matches.length,
    data: slice.map(slimToScryfall),
  };
}

function cardComparator(order: 'edhrec' | 'cmc' | 'name'): (a: SlimCard, b: SlimCard) => number {
  if (order === 'cmc') return (a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name);
  if (order === 'name') return (a, b) => a.name.localeCompare(b.name);
  // edhrec: lower rank = more popular; cards without a rank go last
  return (a, b) => {
    const ra = a.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  };
}
