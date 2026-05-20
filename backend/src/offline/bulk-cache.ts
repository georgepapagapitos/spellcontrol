import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import streamArray from 'stream-json/streamers/stream-array';
import type { SlimCard } from './types';

/**
 * Superset of the backend's ScryfallCard type — Scryfall's oracle_cards bulk
 * carries fields we don't import elsewhere (keywords, produced_mana, games,
 * set_type, released_at). Local type rather than touching the shared one.
 */
interface ScryfallBulkCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  produced_mana?: string[];
  layout?: string;
  legalities?: Record<string, string>;
  edhrec_rank?: number;
  set: string;
  set_name?: string;
  set_type?: string;
  collector_number?: string;
  released_at?: string;
  games?: string[];
  image_uris?: { small?: string; normal?: string; large?: string };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    colors?: string[];
    image_uris?: { small?: string; normal?: string; large?: string };
  }>;
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
  };
}

const SCRYFALL_BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Persisted gzipped slim oracle bulk. We compute it once a day from Scryfall's
 * `oracle_cards` bulk file (one row per oracle_id) and serve the cached buffer
 * directly. The slim projection drops fields the offline frontend never reads
 * (purchase URIs, rulings URIs, scryfall-internal IDs, foil flags, etc.) which
 * cuts the payload by ~80%.
 */
interface BulkPayload {
  version: string;
  cardCount: number;
  rawBytes: number;
  gzippedBytes: number;
  updatedAt: number;
  gzipped: Buffer;
}

let current: BulkPayload | null = null;
let inflight: Promise<BulkPayload> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
/**
 * Most recent build failure. When a build throws, callers can ask `bulkStatus()`
 * for a structured signal instead of having to await another failing build.
 * Cleared on the next successful build.
 */
let lastError: { message: string; at: number } | null = null;

interface BulkIndexEntry {
  type: string;
  download_uri: string;
  updated_at: string;
  size?: number;
}

interface BulkIndexResponse {
  data: BulkIndexEntry[];
}

async function fetchOracleBulkUrl(): Promise<{ url: string; updatedAt: string }> {
  const res = await fetch(SCRYFALL_BULK_INDEX_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Scryfall bulk index returned ${res.status}`);
  }
  const body = (await res.json()) as BulkIndexResponse;
  const entry = body.data.find((e) => e.type === 'oracle_cards');
  if (!entry) throw new Error('Scryfall bulk index has no oracle_cards entry');
  return { url: entry.download_uri, updatedAt: entry.updated_at };
}

function slimCard(card: ScryfallBulkCard): SlimCard | null {
  if (!card.oracle_id || !card.name) return null;
  // Skip non-paper digital-only cards and Alchemy duplicates we never want offline.
  if (card.set_type === 'alchemy') return null;
  if (card.games && Array.isArray(card.games) && !card.games.includes('paper')) {
    // Keep arena-only commanders (e.g. Brawl-only) out of offline lookups.
    return null;
  }
  return {
    oracleId: card.oracle_id,
    scryfallId: card.id,
    name: card.name,
    manaCost: card.mana_cost || undefined,
    cmc: typeof card.cmc === 'number' ? card.cmc : 0,
    typeLine: card.type_line || '',
    oracleText: card.oracle_text || undefined,
    colors: card.colors ?? [],
    colorIdentity: card.color_identity ?? [],
    keywords: card.keywords ?? [],
    producedMana: card.produced_mana,
    layout: card.layout,
    legalities: card.legalities ?? {},
    edhrecRank: card.edhrec_rank,
    set: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    releasedAt: card.released_at,
    imageSmall: card.image_uris?.small,
    imageNormal: card.image_uris?.normal,
    imageLarge: card.image_uris?.large,
    faces: card.card_faces?.map((f) => ({
      name: f.name,
      manaCost: f.mana_cost || undefined,
      typeLine: f.type_line || undefined,
      oracleText: f.oracle_text || undefined,
      colors: f.colors,
      imageSmall: f.image_uris?.small,
      imageNormal: f.image_uris?.normal,
      imageLarge: f.image_uris?.large,
    })),
    usdPrice: card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched ?? undefined,
    isGameChanger: undefined, // populated post-build from is:gamechanger search if/when needed
  };
}

async function buildPayload(): Promise<BulkPayload> {
  const { url, updatedAt } = await fetchOracleBulkUrl();
  console.log('[offline] downloading Scryfall oracle bulk from', url);
  const dlRes = await fetch(url);
  if (!dlRes.ok || !dlRes.body) {
    throw new Error(`Scryfall oracle bulk download returned ${dlRes.status}`);
  }

  // Stream-parse the response so we never hold the full ~200MB Scryfall
  // JSON in memory. Without this V8 OOMs at ~384MB heap inside
  // JSON.parse even on a 768MB container — bulk + parse tree peak around
  // 500-700MB. Pulling one card at a time off the JSON-array stream keeps
  // the working set under ~50MB.
  //
  // `Readable.fromWeb` adapts the WHATWG ReadableStream (whatwg-fetch) into
  // a Node Readable so it can be piped through stream-json.
  const nodeStream = Readable.fromWeb(dlRes.body as Parameters<typeof Readable.fromWeb>[0]);
  // `withParserAsStream` is the combined parser + streamArray Duplex; emits
  // one `{ key, value }` per top-level array element.
  const pipeline = nodeStream.pipe(streamArray.withParserAsStream());

  const slims: SlimCard[] = [];
  for await (const entry of pipeline) {
    const card = (entry as { value: ScryfallBulkCard }).value;
    const s = slimCard(card);
    if (s) slims.push(s);
  }

  const json = JSON.stringify(slims);
  const raw = Buffer.from(json, 'utf-8');
  const gz = gzipSync(raw);
  const version = createHash('sha1').update(raw).digest('hex').slice(0, 16);

  console.log(
    `[offline] slim oracle bulk built: ${slims.length} cards, ${(raw.byteLength / 1_000_000).toFixed(1)}MB raw, ${(gz.byteLength / 1_000_000).toFixed(1)}MB gzipped`
  );

  const payload: BulkPayload = {
    version,
    cardCount: slims.length,
    rawBytes: raw.byteLength,
    gzippedBytes: gz.byteLength,
    updatedAt: Date.parse(updatedAt) || Date.now(),
    gzipped: gz,
  };

  void persistToDisk(payload).catch((err) => {
    console.warn('[offline] failed to persist bulk to disk:', err);
  });

  return payload;
}

function diskPath(): string {
  return path.join(__dirname, '..', '..', 'data', 'offline-oracle.json.gz');
}

function diskMetaPath(): string {
  return path.join(__dirname, '..', '..', 'data', 'offline-oracle.meta.json');
}

interface PersistedMeta {
  version: string;
  cardCount: number;
  rawBytes: number;
  gzippedBytes: number;
  updatedAt: number;
}

async function persistToDisk(payload: BulkPayload): Promise<void> {
  const dir = path.dirname(diskPath());
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(diskPath(), payload.gzipped);
  const meta: PersistedMeta = {
    version: payload.version,
    cardCount: payload.cardCount,
    rawBytes: payload.rawBytes,
    gzippedBytes: payload.gzippedBytes,
    updatedAt: payload.updatedAt,
  };
  await fs.promises.writeFile(diskMetaPath(), JSON.stringify(meta));
}

async function loadFromDisk(): Promise<BulkPayload | null> {
  try {
    const [gz, metaText] = await Promise.all([
      fs.promises.readFile(diskPath()),
      fs.promises.readFile(diskMetaPath(), 'utf-8'),
    ]);
    const meta = JSON.parse(metaText) as PersistedMeta;
    return {
      version: meta.version,
      cardCount: meta.cardCount,
      rawBytes: meta.rawBytes,
      gzippedBytes: meta.gzippedBytes,
      updatedAt: meta.updatedAt,
      gzipped: gz,
    };
  } catch {
    return null;
  }
}

/**
 * Return the current bulk payload, building it if missing. Concurrent callers
 * share the same in-flight promise so we never download twice in parallel.
 *
 * Heavy first call (~30-60s to download + parse + slim + gzip ~200MB of
 * Scryfall JSON). For HTTP routes prefer `getOracleBulkIfReady()` so the
 * request returns 503 instead of risking an nginx timeout.
 */
export async function getOracleBulk(): Promise<BulkPayload> {
  if (current) return current;
  if (!inflight) {
    inflight = (async () => {
      const fromDisk = await loadFromDisk();
      if (fromDisk) {
        current = fromDisk;
        lastError = null;
        return fromDisk;
      }
      const fresh = await buildPayload();
      current = fresh;
      lastError = null;
      return fresh;
    })()
      .catch((err) => {
        lastError = { message: err instanceof Error ? err.message : String(err), at: Date.now() };
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Status snapshot for the HTTP layer — never blocks. Routes use this to
 * decide between serving the bulk or returning 503 with a Retry-After hint.
 */
export interface BulkStatus {
  state: 'ready' | 'building' | 'error' | 'idle';
  payload: BulkPayload | null;
  error: { message: string; at: number } | null;
}

export function getOracleBulkStatus(): BulkStatus {
  if (current) return { state: 'ready', payload: current, error: null };
  if (inflight) return { state: 'building', payload: null, error: lastError };
  if (lastError) return { state: 'error', payload: null, error: lastError };
  return { state: 'idle', payload: null, error: null };
}

/**
 * Kick off a build in the background if one isn't already in flight. Fire-
 * and-forget — callers don't wait on the result. Used at server boot so the
 * very first manifest request doesn't pay the full 30-60s build cost.
 */
export function ensureOracleBulkBuilding(): void {
  if (current || inflight) return;
  void getOracleBulk().catch((err) => {
    console.warn('[offline] background oracle build failed:', err);
  });
}

export async function refreshOracleBulk(): Promise<BulkPayload> {
  // If a build is already in flight (e.g. kicked off by ensureOracleBulkBuilding),
  // wait for it to settle before starting a new one. Without this, the new
  // promise overwrites `inflight` but the old promise keeps running in the
  // background and can restore `current` after a caller has cleared it.
  if (inflight) {
    try {
      await inflight;
    } catch {
      // Existing build failed — that's recorded in lastError; we'll retry below.
    }
  }
  inflight = buildPayload()
    .then((fresh) => {
      current = fresh;
      lastError = null;
      return fresh;
    })
    .catch((err) => {
      lastError = { message: err instanceof Error ? err.message : String(err), at: Date.now() };
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Kick off the initial build (in the background) and schedule a daily refresh.
 * Idempotent — safe to call once at server boot.
 */
export function scheduleOracleRefresh(): void {
  ensureOracleBulkBuilding();
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    refreshOracleBulk().catch((err) => {
      console.warn('[offline] scheduled oracle refresh failed:', err);
    });
  }, REFRESH_INTERVAL_MS);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

export async function __resetOracleBulkForTesting(): Promise<void> {
  // Drain any in-flight build first so its `.then` doesn't restore `current`
  // after we've cleared it — otherwise tests that flip between reset and an
  // immediate HTTP request race with a still-running build kicked off by a
  // prior `sendBuilding()` call.
  if (inflight) {
    try {
      await inflight;
    } catch {
      // ignore — failures are already recorded in lastError
    }
  }
  current = null;
  inflight = null;
  lastError = null;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
