import { tokensFromParts, type RelatedPart } from './card-tokens';
import { logger } from './logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { ScryfallCard } from './types';
import type { ScryfallCache } from './cache';
import { cardAliasKeys, SCRYFALL_USER_AGENT } from './scryfall';
import { pipeForwardingErrors } from './stream-utils';
import { normalizeCardImages } from './scryfall-images';

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
 * Milliseconds to idle after each flush, so this job cannot monopolize the CPU.
 *
 * ⚠️ `setImmediate` alone is NOT enough, and assuming it was cost a production
 * outage. Yielding lets a queued request *run*, but it hands the CPU straight
 * back — so on `shared-cpu-1x` the ingest still burns the burst quota, Fly
 * throttles the machine, and a healthy app answers a trivial endpoint in 12.5s.
 * The health check (5s at the time) then failed and the proxy evicted the only
 * instance: the app was alive and serving the whole time.
 *
 * A real delay is what caps the duty cycle. At ~107k cards / 1000 per batch
 * that is ~107 flushes, so 25ms costs the run about 3 seconds of wall clock —
 * nothing for an unattended nightly job — while leaving the event loop genuinely
 * idle between transactions instead of merely interruptible.
 *
 * `0` disables pacing (tests, and local runs where the CPU is not contended).
 */
const FLUSH_PAUSE_MS = Number(process.env.SCRYFALL_BULK_FLUSH_PAUSE_MS ?? 25);

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
  /** Raw Scryfall relationships. Read only to distill `tokens` out of, and
   *  deliberately NOT carried into the cached row — it holds a uri and an id
   *  per related card, which is most of its weight and none of its use. */
  all_parts?: RelatedPart[];
}

export interface BulkIndexEntry {
  type: string;
  /**
   * Scryfall's current field: a gzipped, line-delimited JSON feed. It replaced
   * `download_uri` (an uncompressed JSON *array*), which no longer appears in
   * the index at all — reading the old name yielded `undefined`, and the daily
   * ingest died on `fetch(undefined)` every night, caught and logged rather
   * than thrown so nothing surfaced. `download_uri` stays here, optional, so a
   * rollback on their side still resolves.
   */
  jsonl_download_uri?: string;
  download_uri?: string;
  updated_at: string;
  size?: number;
  compressed_size?: number;
}

export interface BulkIndexResponse {
  data: BulkIndexEntry[];
}

/**
 * Fetches the Scryfall bulk-data index and returns the entry for the given
 * `type` (e.g. `'default_cards'` or `'oracle_cards'`). Throws if the request
 * fails, the type is absent, or the entry carries no usable download URI —
 * the last of which used to sail through as `undefined` and only fail later.
 *
 * `gzipped` tells the caller how to read it: the JSONL feeds are `.jsonl.gz`,
 * while a legacy `download_uri` would be a plain JSON array.
 */
export async function fetchScryfallBulkEntry(
  type: string
): Promise<{ url: string; updatedAt: string; jsonl: boolean }> {
  const res = await fetch(SCRYFALL_BULK_INDEX_URL, {
    headers: { Accept: 'application/json', 'User-Agent': SCRYFALL_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Scryfall bulk index returned ${res.status}`);
  const body = (await res.json()) as BulkIndexResponse;
  const entry = body.data.find((e) => e.type === type);
  if (!entry) throw new Error(`Scryfall bulk index has no ${type} entry`);
  const url = entry.jsonl_download_uri ?? entry.download_uri;
  if (!url) throw new Error(`Scryfall bulk index entry ${type} has no download URI`);
  return { url, updatedAt: entry.updated_at, jsonl: url === entry.jsonl_download_uri };
}

export interface ResumableDownloadOptions {
  /** Total attempts, first try included. Default 5. */
  maxAttempts?: number;
  /** Delay before retry n is `backoffMs * 2^(n-1)`. Default 2000; tests pass 0. */
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Total size from a `Content-Range: bytes a-b/total` header, or null. */
function totalFromContentRange(h: string | null): number | null {
  const m = h ? /^bytes\s+\d+-\d+\/(\d+)$/i.exec(h.trim()) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Downloads `url` to `dest`, surviving dropped connections. Each failed attempt
 * keeps the bytes already on disk and the next one asks for the rest with a
 * `Range` request. A 206 appends; a 200 to a Range request means the server
 * ignored it, so that file restarts from zero. The finished size is checked
 * against Content-Length (or Content-Range) when the server sent one. On final
 * failure `dest` is deleted, so a caller never inherits a truncated file; on
 * success the caller owns it.
 */
export async function downloadWithResume(
  url: string,
  dest: string,
  opts: ResumableDownloadOptions = {}
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = opts.backoffMs ?? 2000;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  let lastErr: unknown;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await sleep(backoffMs * 2 ** (attempt - 2));
      const have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      try {
        const headers: Record<string, string> = { 'User-Agent': SCRYFALL_USER_AGENT };
        if (have > 0) headers.Range = `bytes=${have}-`;
        // fetch-timeout-exempt: bulk download, streamed to disk
        const res = await fetch(url, { headers });
        if (!res.ok || !res.body) {
          const err = new Error(`Scryfall bulk download returned ${res.status}`);
          // 4xx other than 429 will not change on retry.
          if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 416) {
            fs.rmSync(dest, { force: true });
            throw Object.assign(err, { fatal: true });
          }
          // 416: our offset is past the end or the file changed; start over.
          if (res.status === 416) fs.rmSync(dest, { force: true });
          throw err;
        }
        const resumed = res.status === 206 && have > 0;
        // A 200 (to any request) carries the whole file: restart it from zero.
        if (!resumed) fs.rmSync(dest, { force: true });
        const len = Number(res.headers.get('content-length'));
        const expected = resumed
          ? (totalFromContentRange(res.headers.get('content-range')) ??
            (Number.isFinite(len) && len > 0 ? have + len : null))
          : Number.isFinite(len) && len > 0
            ? len
            : null;
        await streamPipeline(
          Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
          fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' })
        );
        const size = fs.statSync(dest).size;
        if (expected !== null && size !== expected) {
          // Too long cannot be repaired by resuming; too short can.
          if (size > expected) fs.rmSync(dest, { force: true });
          throw new Error(`size mismatch: got ${size} bytes, expected ${expected}`);
        }
        return;
      } catch (err) {
        lastErr = err;
        if ((err as { fatal?: boolean }).fatal) break;
        logger.warn(
          `[scryfall-bulk] download attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Scryfall bulk download failed after ${maxAttempts} attempts: ${reason}`);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

/**
 * Streams a gzipped JSONL bulk feed, yielding one parsed object per line.
 * The dumps are hundreds of MB, so this never materializes the whole feed —
 * same reason the old code used a streaming array parser.
 *
 * Shared with the scanner ingests: three call sites each had their own copy of
 * "fetch the index, read `download_uri`, pipe into a JSON-array parser", and
 * when Scryfall changed the field all three broke independently. One place to
 * fix next time.
 */
export async function* streamBulkJsonl<T>(
  urlOrPath: string,
  opts: ResumableDownloadOptions = {}
): AsyncGenerator<T> {
  const remote = /^https?:\/\//i.test(urlOrPath);
  // A remote feed is saved to a temp file first (with retry and Range resume),
  // then parsed from disk. Streaming straight off the socket died on a single
  // dropped connection and restarted a multi-hour ingest from zero (E1106).
  let tempFile: string | null = null;
  let source = urlOrPath;
  if (remote) {
    const ext = new URL(urlOrPath).pathname.endsWith('.gz') ? '.jsonl.gz' : '.jsonl';
    tempFile = path.join(os.tmpdir(), `scryfall-bulk-${process.pid}-${Date.now()}${ext}`);
    await downloadWithResume(urlOrPath, tempFile, opts);
    source = tempFile;
  }
  // Reading from disk has no socket to starve (see `streamDefaultCards`).
  const nodeStream: Readable = fs.createReadStream(source);
  const lines = createInterface({
    // In the non-gzip case readline watches `nodeStream` directly and rejects
    // on its own; the gzip case needs the forward (see `pipeForwardingErrors`).
    input: source.endsWith('.gz') ? pipeForwardingErrors(nodeStream, createGunzip()) : nodeStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (line) yield JSON.parse(line) as T;
    }
  } finally {
    // A caller breaking out early (the scanner ingest's `--limit`) runs this via
    // the iterator's `return()`.
    lines.close();
    nodeStream.destroy();
    if (tempFile) fs.rmSync(tempFile, { force: true });
  }
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
 * Streams the `default_cards` dump one card at a time. The feed is ~77MB
 * gzipped / far larger raw, so it's never materialized whole — reading it
 * line-by-line keeps peak memory flat regardless of dump size.
 */
/** The downloaded dump, parked next to the cache on the persistent volume. */
function bulkDownloadPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'scryfall-bulk.partial.jsonl.gz');
}

/** Written only once the download is COMPLETE, and records which dump it is. */
function bulkDownloadMarkerPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'scryfall-bulk.partial.json');
}

/**
 * Downloads to `<dest>.downloading`, then renames. The rename is atomic, so a
 * process killed mid-transfer leaves a `.downloading` scrap rather than a
 * truncated file that looks complete.
 */
async function downloadBulkToDisk(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.downloading`;
  await downloadWithResume(url, tmp);
  fs.renameSync(tmp, dest);
}

/**
 * Two-step: download the dump to disk in one pass, then stream-parse from
 * there. **Do not collapse this back into a single streamed fetch.**
 *
 * ## The stall it fixes
 *
 * Parsing straight off the undici response means the socket is consumed only as
 * fast as ~107k synchronous `better-sqlite3` writes allow. That starves the
 * HTTP/2 stream, and the transfer dies mid-run. Measured twice on 2026-08-18,
 * on two separate deploys: the ingest wrote **exactly 3000 rows** (3 flushes of
 * FLUSH_AT) and then made no further progress — the same number both times,
 * which is what ruled out CPU throttling as the cause and pointed at the
 * consumer's rate instead.
 *
 * `scanner/embedding-ingest.ts` already hit this and already fixed it the same
 * way; its note says the streamed pattern "starved the HTTP/2 socket mid-run and
 * tripped `read ETIMEDOUT` somewhere past 1500 records". This file simply never
 * got the same treatment. Reading from disk has no socket to starve, so the
 * ingest can take as long as it takes.
 *
 * ## It also makes an interrupted run resumable (E256)
 *
 * The old code recorded success only at the very end, so a restart re-pulled the
 * whole dump from zero — across six attempts on 2026-08-17 it never once
 * completed. Now a *completed* download is kept on disk with a marker naming the
 * dump it came from; a rerun of the same dump skips straight to ingesting it.
 * The download is ~77MB compressed and is deleted once the ingest succeeds.
 */
export async function* streamDefaultCards(dbPath: string): AsyncGenerator<BulkCard> {
  const { url } = await fetchDefaultCardsUrl();
  const file = bulkDownloadPath(dbPath);
  const marker = bulkDownloadMarkerPath(dbPath);

  const reusable = ((): boolean => {
    try {
      const saved = JSON.parse(fs.readFileSync(marker, 'utf-8')) as { url?: string };
      // Same dump only — a marker from yesterday's dump must not shadow today's.
      return saved.url === url && fs.existsSync(file);
    } catch {
      // No marker, or an unreadable one: treat as nothing to reuse.
      return false;
    }
  })();

  if (reusable) {
    logger.info('[scryfall-bulk] reusing already-downloaded dump', file);
  } else {
    logger.info('[scryfall-bulk] downloading default_cards from', url);
    const t0 = Date.now();
    await downloadBulkToDisk(url, file);
    fs.writeFileSync(marker, JSON.stringify({ url, completedAt: Date.now() }));
    const mb = (fs.statSync(file).size / 1e6).toFixed(1);
    logger.info(`[scryfall-bulk] downloaded ${mb} MB in ${Date.now() - t0}ms`);
  }

  yield* streamBulkJsonl<BulkCard>(file);
}

/** Drops the downloaded dump once it has been fully ingested. */
function clearBulkDownload(dbPath: string): void {
  for (const f of [bulkDownloadPath(dbPath), bulkDownloadMarkerPath(dbPath)]) {
    try {
      fs.rmSync(f, { force: true });
    } catch (err) {
      // Disk space is worth a warning, never a failed ingest.
      logger.warn('[scryfall-bulk] could not remove', f, err);
    }
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
  return normalizeCardImages({
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    power: card.power,
    toughness: card.toughness,
    // A planeswalker's starting loyalty, same class as power/toughness —
    // the card detail and preview panes print it.
    loyalty: card.loyalty,
    // What a land or rock taps for. The mana-base analysis, the cost
    // analyzer and `lib/mana-sources` all read it; without it a Command
    // Tower produces no colors as far as this app is concerned.
    produced_mana: card.produced_mana,
    // Partner detection, flash/changeling checks, the commander profile —
    // roughly twenty reads across the deck builder.
    keywords: card.keywords,
    // Arena-only filtering. The ingest already drops digital-only
    // printings, so this is belt-and-braces — but a live-fetched card
    // carries it, and a cached one reading differently from a fetched one
    // is exactly the inconsistency this whole whitelist keeps producing.
    games: card.games,
    // Printed flavor text, for the card detail pane. Same weight class as
    // `oracle_text`, which is already here.
    flavor_text: card.flavor_text,
    // Distilled rather than stored raw: `all_parts` carries a uri + id per
    // related card and would roughly double a token-maker's cached row, for
    // two fields anybody reads. Without this the deck-token checklist — the
    // deck page's "Tokens to prep" sheet AND the playtest token picker —
    // resolves nothing at all on web, because this cache is where those
    // lookups land.
    tokens: tokensFromParts(card.all_parts),
    colors: card.colors,
    color_identity: card.color_identity,
    rarity: card.rarity ?? 'common',
    set: card.set,
    set_name: card.set_name ?? '',
    collector_number: card.collector_number,
    released_at: card.released_at,
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
  });
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

  // A run takes many minutes and previously logged only "downloading" and
  // "done" — so a healthy slow run and a hung one looked identical from the
  // outside, which cost real time during the 2026-08-18 investigation (the only
  // way to tell them apart was querying MAX(cached_at) out of the live DB over
  // SSH). One line per 10k cards is enough to see progress and rate.
  const startedAt = Date.now();
  let lastLoggedAt = 0;
  const PROGRESS_EVERY = 10_000;

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
    if (written - lastLoggedAt >= PROGRESS_EVERY) {
      lastLoggedAt = written;
      logger.info(
        `[scryfall-bulk] ${written} cards, ${aliases} aliases in ${Math.round((Date.now() - startedAt) / 1000)}s`
      );
    }
    // Idle between transactions. `setImmediate` yields but takes the CPU
    // straight back; a real pause is what stops this job eating the machine's
    // shared-CPU quota and getting the instance evicted. See FLUSH_PAUSE_MS.
    await new Promise<void>((resolve) =>
      FLUSH_PAUSE_MS > 0 ? setTimeout(resolve, FLUSH_PAUSE_MS) : setImmediate(resolve)
    );
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
  const result = await ingestScryfallBulk(streamDefaultCards(dbPath), cache);
  writeBulkMeta(dbPath, { updatedAt: Date.now() });
  clearBulkDownload(dbPath);
  logger.info(
    `[scryfall-bulk] ingest done in ${Date.now() - start}ms — ` +
      `wrote ${result.written} cards, ${result.aliases} aliases, skipped ${result.skipped}`
  );
  return result;
}
