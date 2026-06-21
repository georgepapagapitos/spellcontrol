/**
 * Proxy + cache for MTGJSON's preconstructed-product data (T17).
 *
 * Two layers, both in-memory (deck/collection state stays client-side — the
 * backend is just an integration proxy, like {@link ./sets.ts}):
 *   - the DeckList **index** (~2700 products), one TTL'd singleton + in-flight
 *     dedupe, used for search;
 *   - individual **deck files** (~0.5MB each), a small LRU — there's no point
 *     persisting 2700 blobs, and the per-card SQLite cache is the wrong shape.
 *
 * Node's fetch transparently decompresses MTGJSON's gzip, so we hit the plain
 * `.json` URLs. Coverage tracks whatever MTGJSON has ingested; brand-new
 * products (esp. Secret Lair) can lag, and the daily refresh picks them up.
 */
import type { MtgjsonDeckFile } from './product-map';
import { SCRYFALL_USER_AGENT } from './scryfall';

const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const DECK_TTL_MS = 24 * 60 * 60 * 1000;
const DECK_LRU_MAX = 50;
const SEARCH_LIMIT = 50;

const MTGJSON_BASE = 'https://mtgjson.com/api/v5';
const FETCH_HEADERS = { Accept: 'application/json', 'User-Agent': SCRYFALL_USER_AGENT };

/** A row of MTGJSON's `DeckList.json`. */
interface DeckListEntry {
  code: string;
  fileName: string;
  name: string;
  releaseDate?: string;
  type: string;
}

export interface ProductSummary {
  fileName: string;
  code: string;
  name: string;
  type: string;
  releaseDate: string;
}

interface DeckListResponse {
  data: DeckListEntry[];
}

interface DeckFileResponse {
  data: MtgjsonDeckFile;
}

/** Compact commander preview for a product, for lazy enrichment of search rows (T17). */
export interface ProductCommanderSummary {
  name: string;
  colorIdentity: string[];
  /** Full small card image URL — rendered as a card-shaped row thumbnail. */
  image: string | null;
}

// Tiny, long-lived: one entry per product the user has previewed. `null` means
// resolved-but-no-commander (non-commander product) — distinct from "not cached".
const commanderSummaryCache = new Map<string, ProductCommanderSummary | null>();

export function getCachedCommanderSummary(
  fileName: string
): ProductCommanderSummary | null | undefined {
  return commanderSummaryCache.has(fileName) ? commanderSummaryCache.get(fileName) : undefined;
}

export function setCachedCommanderSummary(
  fileName: string,
  summary: ProductCommanderSummary | null
): void {
  commanderSummaryCache.set(fileName, summary);
}

// --- DeckList index (TTL singleton + in-flight dedupe, mirrors sets.ts) -------

let indexCache: { at: number; entries: DeckListEntry[] } | null = null;
let indexInFlight: Promise<DeckListEntry[]> | null = null;

async function getDeckList(): Promise<DeckListEntry[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.entries;
  if (indexInFlight) return indexInFlight;

  indexInFlight = fetchDeckList()
    .then((entries) => {
      indexCache = { at: Date.now(), entries };
      return entries;
    })
    .finally(() => {
      indexInFlight = null;
    });

  return indexInFlight;
}

async function fetchDeckList(): Promise<DeckListEntry[]> {
  const response = await fetch(`${MTGJSON_BASE}/DeckList.json`, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`MTGJSON DeckList returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as DeckListResponse;
  return json.data ?? [];
}

function toSummary(e: DeckListEntry): ProductSummary {
  return {
    fileName: e.fileName,
    code: e.code,
    name: e.name,
    type: e.type,
    releaseDate: e.releaseDate ?? '',
  };
}

/**
 * Searches the product index. `query` matches product names (case-insensitive);
 * `types` restricts to those MTGJSON `type` values (e.g. "Commander Deck"). With
 * no query, returns the newest products (optionally of the given types).
 */
export async function searchProducts(
  query: string,
  opts: { types?: string[] } = {}
): Promise<ProductSummary[]> {
  const entries = await getDeckList();
  const typeSet = opts.types && opts.types.length ? new Set(opts.types) : null;
  const pool = typeSet ? entries.filter((e) => typeSet.has(e.type)) : entries;

  const q = query.trim().toLowerCase();
  if (!q) {
    return [...pool]
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
      .slice(0, SEARCH_LIMIT)
      .map(toSummary);
  }

  // Rank: exact (0) > prefix (1) > word-boundary (2) > substring (3); recency tiebreak.
  const scored: { e: DeckListEntry; rank: number }[] = [];
  for (const e of pool) {
    const name = e.name.toLowerCase();
    let rank: number;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(` ${q}`)) rank = 2;
    else if (name.includes(q)) rank = 3;
    else continue;
    scored.push({ e, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || (b.e.releaseDate ?? '').localeCompare(a.e.releaseDate ?? '')
  );
  return scored.slice(0, SEARCH_LIMIT).map((s) => toSummary(s.e));
}

/** Resolves a fileName to its index entry (also the path-traversal guard). */
export async function getProductSummary(fileName: string): Promise<ProductSummary | null> {
  const entries = await getDeckList();
  const entry = entries.find((e) => e.fileName === fileName);
  return entry ? toSummary(entry) : null;
}

// --- Per-deck file LRU --------------------------------------------------------

const deckCache = new Map<string, { at: number; deck: MtgjsonDeckFile }>();
const deckInFlight = new Map<string, Promise<MtgjsonDeckFile | null>>();

/**
 * Fetches and caches a product's full deck file. Returns null when the fileName
 * isn't in the index (unknown/not-yet-ingested product) — which is also what
 * guards against arbitrary-path fetches, since only catalogued fileNames pass.
 */
export async function getProductDeck(fileName: string): Promise<MtgjsonDeckFile | null> {
  const cached = deckCache.get(fileName);
  if (cached && Date.now() - cached.at < DECK_TTL_MS) {
    // Mark as recently used.
    deckCache.delete(fileName);
    deckCache.set(fileName, cached);
    return cached.deck;
  }

  const existing = deckInFlight.get(fileName);
  if (existing) return existing;

  const promise = fetchProductDeck(fileName)
    .then((deck) => {
      if (deck) putDeck(fileName, deck);
      return deck;
    })
    .finally(() => {
      deckInFlight.delete(fileName);
    });

  deckInFlight.set(fileName, promise);
  return promise;
}

async function fetchProductDeck(fileName: string): Promise<MtgjsonDeckFile | null> {
  // Only catalogued fileNames are fetchable (validates the param + prevents SSRF).
  const summary = await getProductSummary(fileName);
  if (!summary) return null;

  const response = await fetch(`${MTGJSON_BASE}/decks/${encodeURIComponent(fileName)}.json`, {
    headers: FETCH_HEADERS,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`MTGJSON deck ${fileName} returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as DeckFileResponse;
  return json.data ?? null;
}

function putDeck(fileName: string, deck: MtgjsonDeckFile): void {
  deckCache.set(fileName, { at: Date.now(), deck });
  // Evict oldest (Map preserves insertion order) once over the cap.
  while (deckCache.size > DECK_LRU_MAX) {
    const oldest = deckCache.keys().next().value;
    if (oldest === undefined) break;
    deckCache.delete(oldest);
  }
}

/** Test-only: clears both cache layers. */
export function __resetProductCaches(): void {
  indexCache = null;
  indexInFlight = null;
  deckCache.clear();
  deckInFlight.clear();
  commanderSummaryCache.clear();
}
