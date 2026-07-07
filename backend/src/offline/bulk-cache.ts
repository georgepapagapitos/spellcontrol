import { logger } from '../logger';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { SlimCard, SlimTokenRef } from './types';
import { SCRYFALL_USER_AGENT } from '../scryfall';
import { NON_PLAYABLE_LAYOUTS, fetchScryfallBulkEntry } from '../scryfall-bulk';

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
  rarity?: string;
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
  /** Related-card relationships — tokens, meld parts, combo pieces, etc. */
  all_parts?: Array<{ component?: string; name?: string; type_line?: string }>;
}

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Bumped whenever `slimCard()`'s projection or filtering logic changes. The
 * persisted bulk lives on a volume that survives deploys, so without this a
 * logic change wouldn't take effect until the next daily rebuild — `loadFromDisk`
 * discards a payload built by an older builder and forces a fresh build.
 *   2 — exclude non-playable layouts (art_series/token/...) + memorabilia.
 *   3 — carry `rarity` so consumers don't default everything to common.
 *   4 — carry `tokens` (a card's creatable tokens, from all_parts) for the
 *       deck token checklist.
 *   5 — populate `isGameChanger` (was permanently undefined) so the offline
 *       `is:gamechanger` search operator returns results (E108).
 */
const BUILDER_VERSION = 5;

const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';

interface ScryfallSearchNameOnly {
  data: Array<{ name: string }>;
  has_more: boolean;
}

/**
 * Official Commander Game Changers list (Feb 9, 2026 — 53 cards). Mirrors
 * `HARDCODED_GAME_CHANGERS` in frontend/src/deck-builder/services/scryfall/client.ts
 * (kept verbatim, not imported — the backend can't reach into frontend source).
 * Used as a floor when the live `is:gamechanger` query fails or returns partial
 * results, so a Scryfall outage during the daily bulk build doesn't silently
 * zero out every card's flag.
 */
const HARDCODED_GAME_CHANGERS: ReadonlySet<string> = new Set([
  // White
  'Drannith Magistrate',
  'Enlightened Tutor',
  'Farewell',
  'Humility',
  "Serra's Sanctum",
  'Smothering Tithe',
  "Teferi's Protection",
  // Blue
  'Consecrated Sphinx',
  'Cyclonic Rift',
  'Fierce Guardianship',
  'Force of Will',
  'Gifts Ungiven',
  'Intuition',
  'Mystical Tutor',
  'Narset, Parter of Veils',
  'Rhystic Study',
  "Thassa's Oracle",
  // Black
  'Ad Nauseam',
  "Bolas's Citadel",
  'Braids, Cabal Minion',
  'Demonic Tutor',
  'Imperial Seal',
  'Necropotence',
  'Opposition Agent',
  'Orcish Bowmasters',
  'Tergrid, God of Fright',
  'Vampiric Tutor',
  // Red
  'Gamble',
  "Jeska's Will",
  'Underworld Breach',
  // Green
  'Biorhythm',
  'Crop Rotation',
  "Gaea's Cradle",
  'Natural Order',
  'Seedborn Muse',
  'Survival of the Fittest',
  'Worldly Tutor',
  // Multicolor
  'Aura Shards',
  'Coalition Victory',
  'Grand Arbiter Augustin IV',
  'Notion Thief',
  // Colorless / Lands
  'Ancient Tomb',
  'Chrome Mox',
  'Field of the Dead',
  'Glacial Chasm',
  'Grim Monolith',
  "Lion's Eye Diamond",
  'Mana Vault',
  "Mishra's Workshop",
  'Mox Diamond',
  'Panoptic Mirror',
  'The One Ring',
  'The Tabernacle at Pendrell Vale',
]);

/**
 * Live paginated fetch of every `is:gamechanger` card name from Scryfall,
 * unioned with {@link HARDCODED_GAME_CHANGERS} as a floor. The bulk build
 * already requires network (it downloads the ~200MB oracle bulk), so this
 * extra query rides the same network dependency rather than duplicating the
 * RC's list as the sole source of truth. On any failure (a page throws) we
 * log and fall back to the hardcoded list alone — same graceful degrade as
 * the rest of the build.
 */
async function fetchGameChangerNames(): Promise<Set<string>> {
  const names = new Set<string>();
  let page = 1;
  let hasMore = true;
  try {
    while (hasMore) {
      const res = await fetch(
        `${SCRYFALL_SEARCH_URL}?q=${encodeURIComponent('is:gamechanger')}&page=${page}`,
        { headers: { 'User-Agent': SCRYFALL_USER_AGENT } }
      );
      if (!res.ok) throw new Error(`Scryfall is:gamechanger search returned ${res.status}`);
      const body = (await res.json()) as ScryfallSearchNameOnly;
      for (const card of body.data) names.add(card.name);
      hasMore = body.has_more;
      page++;
    }
  } catch (err) {
    logger.warn('[offline] live is:gamechanger fetch failed, falling back to hardcoded list:', err);
    return new Set(HARDCODED_GAME_CHANGERS);
  }
  return new Set([...HARDCODED_GAME_CHANGERS, ...names]);
}

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

async function fetchOracleBulkUrl(): Promise<{ url: string; updatedAt: string }> {
  return fetchScryfallBulkEntry('oracle_cards');
}

/**
 * Distill a card's token output from Scryfall's `all_parts` array: keep only the
 * `component === 'token'` entries (tokens + emblems), dedupe by name+type, and
 * drop everything else (the card itself, meld/combo parts). Returns undefined
 * when the card makes no tokens so the field stays absent in the slim payload.
 */
function tokensFromParts(parts: ScryfallBulkCard['all_parts']): SlimTokenRef[] | undefined {
  if (!parts || parts.length === 0) return undefined;
  const seen = new Set<string>();
  const out: SlimTokenRef[] = [];
  for (const p of parts) {
    if (p.component !== 'token' || !p.name) continue;
    const key = `${p.name} ${p.type_line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.type_line ? { name: p.name, typeLine: p.type_line } : { name: p.name });
  }
  return out.length > 0 ? out : undefined;
}

function slimCard(card: ScryfallBulkCard, gameChangerNames: ReadonlySet<string>): SlimCard | null {
  if (!card.oracle_id || !card.name) return null;
  // Skip non-paper digital-only cards and Alchemy duplicates we never want offline.
  if (card.set_type === 'alchemy') return null;
  // Skip non-game-piece layouts (art cards, tokens, emblems, ...) and oversized
  // memorabilia printings — none are deck-legal and they collide on `name`.
  if (card.layout && NON_PLAYABLE_LAYOUTS.has(card.layout)) return null;
  if (card.set_type === 'memorabilia') return null;
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
    rarity: card.rarity,
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
    isGameChanger: gameChangerNames.has(card.name) || undefined,
    tokens: tokensFromParts(card.all_parts),
  };
}

async function buildPayload(): Promise<BulkPayload> {
  const [{ url, updatedAt }, gameChangerNames] = await Promise.all([
    fetchOracleBulkUrl(),
    fetchGameChangerNames(),
  ]);
  logger.info('[offline] downloading Scryfall oracle bulk from', url);
  const dlRes = await fetch(url, { headers: { 'User-Agent': SCRYFALL_USER_AGENT } });
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
    const s = slimCard(card, gameChangerNames);
    if (s) slims.push(s);
  }

  const json = JSON.stringify(slims);
  const raw = Buffer.from(json, 'utf-8');
  const gz = gzipSync(raw);
  const version = createHash('sha1').update(raw).digest('hex').slice(0, 16);

  logger.info(
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

  // Capture the target dir NOW (build time), not inside the deferred persist —
  // see persistToDisk's note on the fire-and-forget race.
  const persistDir = offlineDataDir();
  void persistToDisk(payload, persistDir).catch((err) => {
    logger.warn('[offline] failed to persist bulk to disk:', err);
  });

  return payload;
}

/**
 * Where the persisted bulk + meta live. Priority:
 *   1. `OFFLINE_DATA_DIR` — explicit opt-in for custom layouts.
 *   2. `dirname(DB_PATH)` — by default we co-locate with the SQLite cache so
 *      a single `/data` volume mount (the Docker default) survives across
 *      container recreates. Without this fallback the bulk landed at
 *      `/app/data/...` inside the container layer and was lost on every
 *      restart, forcing a fresh 30-60s rebuild + ~700MB heap peak.
 *   3. The dev-mode `backend/data/` path next to the source tree.
 */
function offlineDataDir(): string {
  if (process.env.OFFLINE_DATA_DIR) return process.env.OFFLINE_DATA_DIR;
  if (process.env.DB_PATH) return path.dirname(process.env.DB_PATH);
  return path.join(__dirname, '..', '..', 'data');
}

const ORACLE_GZ_FILE = 'offline-oracle.json.gz';
const ORACLE_META_FILE = 'offline-oracle.meta.json';

function diskPath(): string {
  return path.join(offlineDataDir(), ORACLE_GZ_FILE);
}

function diskMetaPath(): string {
  return path.join(offlineDataDir(), ORACLE_META_FILE);
}

interface PersistedMeta {
  version: string;
  cardCount: number;
  rawBytes: number;
  gzippedBytes: number;
  updatedAt: number;
  builderVersion?: number;
}

// `dir` is captured by the caller at build time, NOT re-derived from the env
// here. persistToDisk is fire-and-forget, so reading offlineDataDir() at write
// time would race against a later env change (in tests, that wrote a mock bundle
// over the real one). Pinning the dir up front makes the write deterministic.
async function persistToDisk(payload: BulkPayload, dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, ORACLE_GZ_FILE), payload.gzipped);
  const meta: PersistedMeta = {
    version: payload.version,
    cardCount: payload.cardCount,
    rawBytes: payload.rawBytes,
    gzippedBytes: payload.gzippedBytes,
    updatedAt: payload.updatedAt,
    builderVersion: BUILDER_VERSION,
  };
  await fs.promises.writeFile(path.join(dir, ORACLE_META_FILE), JSON.stringify(meta));
}

async function loadFromDisk(): Promise<BulkPayload | null> {
  try {
    const [gz, metaText] = await Promise.all([
      fs.promises.readFile(diskPath()),
      fs.promises.readFile(diskMetaPath(), 'utf-8'),
    ]);
    const meta = JSON.parse(metaText) as PersistedMeta;
    // Discard a payload built by an older slimCard() — forces a fresh rebuild
    // on deploy when the projection/filtering logic has changed.
    if (meta.builderVersion !== BUILDER_VERSION) {
      logger.info(
        `[offline] persisted bulk built by builder v${meta.builderVersion ?? 'pre-versioning'}, current is v${BUILDER_VERSION} — rebuilding`
      );
      return null;
    }
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
        scheduleDailyRefresh();
        return fromDisk;
      }
      const fresh = await buildPayload();
      current = fresh;
      lastError = null;
      scheduleDailyRefresh();
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
    logger.warn('[offline] background oracle build failed:', err);
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
 * Register the daily refresh interval. Called automatically by `getOracleBulk`
 * after the first successful build/load so the interval only ever runs while
 * a payload is in memory — avoids paying the 30-60s rebuild cost on a server
 * whose users never asked for the offline bundle. Idempotent.
 */
function scheduleDailyRefresh(): void {
  if (refreshTimer) return;
  if (process.env.OFFLINE_BULK_DISABLED === '1') return;
  refreshTimer = setInterval(runDailyRefreshTick, REFRESH_INTERVAL_MS);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

/**
 * Periodic-refresh body, factored out so tests can drive it directly. The
 * `current !== null` gate is the safety net that ensures we never start a
 * 30-60s rebuild on a payload nobody has asked for yet — also covers the
 * race where a test resets state while the timer is still armed.
 */
function runDailyRefreshTick(): void {
  if (!current) return;
  refreshOracleBulk().catch((err) => {
    logger.warn('[offline] scheduled oracle refresh failed:', err);
  });
}

export function __getRefreshTimerForTesting(): NodeJS.Timeout | null {
  return refreshTimer;
}

export function __runDailyRefreshTickForTesting(): void {
  runDailyRefreshTick();
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
