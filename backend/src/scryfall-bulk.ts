import { logger } from './logger';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { ScryfallCard } from './types';
import type { ScryfallCache } from './cache';
import { cardAliasKeys, SCRYFALL_USER_AGENT } from './scryfall';

/**
 * Ingests Scryfall's daily `default_cards` bulk dump into the SQLite card cache so
 * imports resolve fully locally instead of fanning out to Scryfall.
 *
 * Why `default_cards` (not `oracle_cards`): import resolution keys on individual
 * *printings* — by Scryfall id, and by name+set(+collector) — so we need one row
 * per printing. `oracle_cards` (used by the offline frontend bulk) is one row per
 * card identity and can't answer a name+set+collector lookup.
 *
 * Pre-populating the cache turns the common case (re-importing a Moxfield /
 * Archidekt / Deckbox / ManaBox file) into a zero-network resolve, and degrades
 * gracefully: anything not in the dump (brand-new spoilers between daily builds,
 * odd collector schemes) still falls back to the live Scryfall path in
 * {@link resolveCards}. The ingest only ever *adds* cache hits.
 */

export const SCRYFALL_BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
/** Flush to SQLite every N cards so peak memory stays flat regardless of dump size. */
const FLUSH_AT = 1000;

/**
 * Superset of our {@link ScryfallCard} — the bulk dump carries fields we use to
 * decide whether a printing is a real paper card before storing it.
 */
interface BulkCard extends Partial<ScryfallCard> {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  games?: string[];
  set_type?: string;
}

export interface BulkIndexEntry {
  type: string;
  download_uri: string;
  updated_at: string;
  size?: number;
}

export interface BulkIndexResponse {
  data: BulkIndexEntry[];
}

/**
 * Fetches the Scryfall bulk-data index and returns the entry for the given
 * `type` (e.g. `'default_cards'` or `'oracle_cards'`). Throws if the request
 * fails or the type is absent from the index.
 */
export async function fetchScryfallBulkEntry(
  type: string
): Promise<{ url: string; updatedAt: string }> {
  const res = await fetch(SCRYFALL_BULK_INDEX_URL, {
    headers: { Accept: 'application/json', 'User-Agent': SCRYFALL_USER_AGENT },
  });
  if (!res.ok) throw new Error(`Scryfall bulk index returned ${res.status}`);
  const body = (await res.json()) as BulkIndexResponse;
  const entry = body.data.find((e) => e.type === type);
  if (!entry) throw new Error(`Scryfall bulk index has no ${type} entry`);
  return { url: entry.download_uri, updatedAt: entry.updated_at };
}

/** Scryfall layouts that aren't real game pieces and can share a name with the
 *  card they depict — excluded from name+set alias generation so they don't
 *  shadow the real card. (They still resolve fine by id.) */
export const NON_PLAYABLE_LAYOUTS = new Set([
  'art_series',
  'token',
  'double_faced_token',
  'emblem',
  'scheme',
  'planar',
  'vanguard',
]);

async function fetchDefaultCardsUrl(): Promise<{ url: string; updatedAt: string }> {
  return fetchScryfallBulkEntry('default_cards');
}

/**
 * Streams the `default_cards` dump one card at a time. The file is ~450MB+ of a
 * single JSON array; a `JSON.parse` of the whole thing would OOM small
 * containers, so we pull elements off a streaming parser (same pattern as the
 * offline oracle bulk and the scanner ingests). Yields raw bulk cards.
 */
export async function* streamDefaultCards(): AsyncGenerator<BulkCard> {
  const { url } = await fetchDefaultCardsUrl();
  logger.info('[scryfall-bulk] downloading default_cards from', url);
  const res = await fetch(url, { headers: { 'User-Agent': SCRYFALL_USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`Scryfall default_cards download returned ${res.status}`);
  }
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  const pipeline = nodeStream.pipe(streamArray.withParserAsStream());
  for await (const entry of pipeline) {
    yield (entry as { value: BulkCard }).value;
  }
}

/**
 * Projects a bulk card down to the {@link ScryfallCard} fields the app actually
 * reads (the rest of the dump — uris, rulings, internal ids — is dropped, roughly
 * halving stored size). Returns null for cards we don't want in the cache:
 * non-paper (digital-only / Alchemy) printings that can't appear in a physical
 * collection.
 */
export function projectBulkCard(card: BulkCard): ScryfallCard | null {
  if (!card.id || !card.name || !card.set || !card.collector_number) return null;
  // Drop digital-only printings — they can't be in a paper collection and would
  // only bloat the cache / shadow real printings.
  if (Array.isArray(card.games) && !card.games.includes('paper')) return null;
  if (card.set_type === 'alchemy') return null;
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    colors: card.colors,
    color_identity: card.color_identity,
    rarity: card.rarity ?? 'common',
    set: card.set,
    set_name: card.set_name ?? '',
    collector_number: card.collector_number,
    layout: card.layout,
    legalities: card.legalities,
    oracle_text: card.oracle_text,
    finishes: card.finishes,
    edhrec_rank: card.edhrec_rank,
    frame_effects: card.frame_effects,
    promo_types: card.promo_types,
    full_art: card.full_art,
    border_color: card.border_color,
    image_uris: card.image_uris,
    prices: card.prices,
    card_faces: card.card_faces,
  };
}

export interface BulkIngestResult {
  /** Cards written to the `cards` table. */
  written: number;
  /** Alias rows written to `card_lookups`. */
  aliases: number;
  /** Bulk entries skipped (non-paper / malformed). */
  skipped: number;
}

/**
 * Drains a stream of bulk cards into the cache: projects each, writes it to the
 * `cards` table, and records its name+set(+collector) aliases. Flushes in
 * batches of {@link FLUSH_AT} (each {@link ScryfallCache.setMany} /
 * {@link ScryfallCache.setLookups} call is its own transaction) and yields to the
 * event loop between batches so health checks aren't starved on the app machine.
 */
export async function ingestScryfallBulk(
  source: AsyncIterable<BulkCard>,
  cache: ScryfallCache
): Promise<BulkIngestResult> {
  let written = 0;
  let aliases = 0;
  let skipped = 0;

  let cardBatch: ScryfallCard[] = [];
  let aliasBatch: Array<{ key: string; scryfallId: string }> = [];

  const flush = async () => {
    if (cardBatch.length > 0) {
      cache.setMany(cardBatch);
      written += cardBatch.length;
      cardBatch = [];
    }
    if (aliasBatch.length > 0) {
      cache.setLookups(aliasBatch);
      aliases += aliasBatch.length;
      aliasBatch = [];
    }
    // Yield so the event loop can service health checks between transactions.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  for await (const raw of source) {
    const card = projectBulkCard(raw);
    if (!card) {
      skipped++;
      continue;
    }
    cardBatch.push(card);
    // Real game pieces get name+set aliases; art cards / tokens / emblems are
    // resolvable by id but excluded from name+set so they don't shadow the real
    // card under a shared name.
    if (!card.layout || !NON_PLAYABLE_LAYOUTS.has(card.layout)) {
      for (const key of cardAliasKeys(card)) {
        aliasBatch.push({ key, scryfallId: card.id });
      }
    }
    if (cardBatch.length >= FLUSH_AT) await flush();
  }
  await flush();

  return { written, aliases, skipped };
}

interface BulkMeta {
  updatedAt: number;
}

/** Meta file co-located with the SQLite cache (on the persistent volume) so a
 *  redeploy/restart can tell whether a recent ingest already ran. */
function bulkMetaPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'scryfall-bulk.meta.json');
}

export function readBulkMeta(dbPath: string): BulkMeta | null {
  try {
    return JSON.parse(fs.readFileSync(bulkMetaPath(dbPath), 'utf-8')) as BulkMeta;
  } catch {
    return null;
  }
}

export function writeBulkMeta(dbPath: string, meta: BulkMeta): void {
  try {
    fs.mkdirSync(path.dirname(bulkMetaPath(dbPath)), { recursive: true });
    fs.writeFileSync(bulkMetaPath(dbPath), JSON.stringify(meta));
  } catch (err) {
    logger.warn('[scryfall-bulk] failed to write meta:', err);
  }
}

/**
 * Runs a full ingest from the network into `cache`, then stamps the meta file.
 * Returns the result, or null if a recent run already covered it (and `force` is
 * not set).
 */
export async function runScryfallBulkIngest(
  cache: ScryfallCache,
  dbPath: string,
  opts: { force?: boolean; minIntervalMs?: number } = {}
): Promise<BulkIngestResult | null> {
  const minInterval = opts.minIntervalMs ?? 20 * 60 * 60 * 1000; // 20h
  if (!opts.force) {
    const meta = readBulkMeta(dbPath);
    if (meta && Date.now() - meta.updatedAt < minInterval) {
      logger.info('[scryfall-bulk] skipping ingest — last successful run was recent');
      return null;
    }
  }
  const start = Date.now();
  const result = await ingestScryfallBulk(streamDefaultCards(), cache);
  writeBulkMeta(dbPath, { updatedAt: Date.now() });
  logger.info(
    `[scryfall-bulk] ingest done in ${Date.now() - start}ms — ` +
      `wrote ${result.written} cards, ${result.aliases} aliases, skipped ${result.skipped}`
  );
  return result;
}
