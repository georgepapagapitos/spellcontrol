import { logger } from './logger';
import type { ScryfallCard, Ruling } from './types';
import type { ScryfallCache } from './cache';
import type { ImportRow } from './parsers/types';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';
const BATCH_SIZE = 75;
/**
 * Scryfall asks for 50–100ms between requests. We pace request *starts* this far
 * apart globally (across concurrent workers) so the aggregate stays within their
 * ~10 req/s ceiling regardless of how many batches are in flight.
 */
const REQUEST_DELAY_MS = 100;
/**
 * How many collection batches we allow in flight at once. Concurrency hides
 * per-request round-trip latency (the real cost of a cold import); REQUEST_DELAY_MS
 * spacing keeps the aggregate rate safe. The 429 backoff in fetchBatchWithRetry is
 * the safety net if we still push too hard.
 */
const BATCH_CONCURRENCY = 3;
/** When we hit a 429, wait at least this long before retrying (we also honor Retry-After). */
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spaces request *starts* at least `minSpacingMs` apart across all callers, even
 * when several run concurrently. Call (and await) the returned function immediately
 * before each request so the aggregate rate stays within Scryfall's ceiling.
 */
function createRateGate(minSpacingMs: number): () => Promise<void> {
  let nextAllowedStart = 0;
  return async () => {
    const now = Date.now();
    const start = Math.max(now, nextAllowedStart);
    nextAllowedStart = start + minSpacingMs;
    const wait = start - now;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight; results come
 * back in input order. Workers here never throw (fetchBatchWithRetry resolves to
 * null on failure), so the run never rejects.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await worker(items[i], i);
    }
  };
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: runnerCount }, run));
  return results;
}

/** Identifier shapes that Scryfall's /cards/collection endpoint accepts. */
type Identifier =
  | { id: string }
  | { name: string; set: string; collector_number: string }
  | { name: string; set: string }
  | { name: string };

interface CollectionResponse {
  object: 'list';
  not_found: Identifier[];
  data: ScryfallCard[];
}

export interface LookupResult {
  /** One ScryfallCard per input row (or undefined if unresolved). Same length and order as input. */
  resolved: Array<ScryfallCard | undefined>;
  /** Names of rows that could not be resolved at all. */
  unresolvedNames: string[];
}

/**
 * Resolves Scryfall data for an array of import rows. Uses cache where possible.
 *
 * Resolution priority per row:
 *   1. If row has scryfallId → look up by ID (most accurate, often hits cache)
 *   2. Else if row has name + setCode + collectorNumber → look up that exact printing
 *   3. Else if row has name + setCode → look up name in that set
 *   4. Else if row has name → look up by name (Scryfall picks a printing)
 *   5. Else → unresolvable, skip
 *
 * The expanded-by-quantity input means many rows share the same identifier (e.g. 4 copies of
 * Sol Ring all share one Scryfall ID). We dedupe identifiers before calling Scryfall, then map
 * a single resolved card back to every row that produced that identifier.
 */
export async function resolveCards(rows: ImportRow[], cache: ScryfallCache): Promise<LookupResult> {
  const resolved: Array<ScryfallCard | undefined> = new Array(rows.length).fill(undefined);

  // Step 1: build the identifier each row needs, and group rows by identifier key.
  // Multiple rows can share an identifier — we'll resolve each unique one once and
  // distribute the result to every row that asked for it.
  const identifierByKey = new Map<string, Identifier>();
  const rowIdxsByKey = new Map<string, number[]>();

  rows.forEach((row, i) => {
    const ident = buildIdentifier(row);
    if (!ident) return;
    const key = identifierKey(ident);
    if (!identifierByKey.has(key)) {
      identifierByKey.set(key, ident);
      rowIdxsByKey.set(key, []);
    }
    rowIdxsByKey.get(key)!.push(i);
  });

  // Step 2: for ID identifiers, hit the cache first.
  const idKeys = Array.from(identifierByKey.entries())
    .filter(([, ident]) => 'id' in ident)
    .map(([key, ident]) => ({ key, id: (ident as { id: string }).id }));

  if (idKeys.length > 0) {
    const cached = cache.getMany(idKeys.map((k) => k.id));
    for (const { key, id } of idKeys) {
      const hit = cached.get(id);
      if (hit) {
        for (const rowIdx of rowIdxsByKey.get(key)!) {
          resolved[rowIdx] = hit;
        }
        identifierByKey.delete(key); // resolved — don't fetch again
      }
    }
  }

  // For name/set/collector identifiers, resolve via the alias table. This is the
  // common case (Moxfield / Archidekt / Deckbox / generic CSV / text lists) and
  // previously always went to the network — so re-importing the same file refetched
  // every card. Aliases are recorded after each successful batch below.
  const nameKeys = Array.from(identifierByKey.keys()).filter((key) => !key.startsWith('id:'));
  if (nameKeys.length > 0) {
    const cachedByKey = cache.getManyByKeys(nameKeys);
    for (const [key, card] of cachedByKey) {
      for (const rowIdx of rowIdxsByKey.get(key)!) {
        resolved[rowIdx] = card;
      }
      identifierByKey.delete(key); // resolved — don't fetch again
    }
  }

  if (identifierByKey.size === 0) {
    return { resolved, unresolvedNames: [] };
  }

  logger.info(
    `[scryfall] resolving ${identifierByKey.size} unique identifiers across ${rows.length} rows`
  );

  // Step 3: batch the remaining identifiers. We send each unique identifier exactly
  // once, with up to BATCH_CONCURRENCY batches in flight. A shared rate gate spaces
  // request starts so the aggregate rate stays within Scryfall's ceiling.
  const pendingEntries = Array.from(identifierByKey.entries());
  const batches: Array<Array<[string, Identifier]>> = [];
  for (let i = 0; i < pendingEntries.length; i += BATCH_SIZE) {
    batches.push(pendingEntries.slice(i, i + BATCH_SIZE));
  }

  const gate = createRateGate(REQUEST_DELAY_MS);

  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch, batchNum) => {
    await gate();
    const json = await fetchBatchWithRetry(
      batch.map(([, ident]) => ident),
      batchNum
    );

    if (!json) {
      logger.warn(
        `[scryfall] batch ${batchNum} returned no data, skipping ${batch.length} identifiers`
      );
      return;
    }

    // Record name/set/collector -> id aliases so a future import of the same file
    // resolves from cache instead of the network. ID identifiers already resolve
    // via the cards table, so they need no alias.
    const aliases: Array<{ key: string; scryfallId: string }> = [];
    for (const [key, ident] of batch) {
      const card = json.data.find((c) => identifierMatchesCard(ident, c));
      if (card) {
        for (const rowIdx of rowIdxsByKey.get(key)!) {
          resolved[rowIdx] = card;
        }
        if (!key.startsWith('id:')) aliases.push({ key, scryfallId: card.id });
      }
    }
    if (json.data.length > 0) {
      cache.setMany(json.data);
    }
    if (aliases.length > 0) {
      cache.setLookups(aliases);
    }
  });

  // Step 4: collect names of rows that never resolved.
  const unresolvedNames: string[] = [];
  rows.forEach((row, i) => {
    if (!resolved[i] && row.name) unresolvedNames.push(row.name);
  });

  return { resolved, unresolvedNames };
}

/**
 * Fetches fresh ScryfallCards by ID, bypassing cache. Used by the price-refresh
 * endpoint, which needs current prices rather than the 7-day-cached snapshot.
 * Honors the same 75/batch + 250ms delay + 429 backoff as bulk import.
 * Updates the cache with whatever Scryfall returns. Returns one card per
 * resolved id (missing ids are simply omitted).
 */
export async function fetchCardsByIds(
  ids: string[],
  cache: ScryfallCache
): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const json = await fetchBatchWithRetry(
      batch.map((id) => ({ id })),
      Math.floor(i / BATCH_SIZE)
    );
    if (json && json.data.length > 0) {
      out.push(...json.data);
      cache.setMany(json.data);
    }
    if (i + BATCH_SIZE < ids.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }
  return out;
}

/**
 * Cache-first single-card fetch by Scryfall id. The scanner v2 matcher
 * resolves a Scryfall UUID per scan, and each captured card needs the
 * full ScryfallCard payload (name, image_uris, prices, etc.) to be
 * useful in the UI. A rapid-fire scan session would hammer Scryfall if
 * we routed through {@link fetchCardsByIds} every time, so we hit the
 * 7-day cache first and only fall back to the network on a miss.
 *
 * Returns null when Scryfall doesn't know the id.
 */
export async function getCardById(id: string, cache: ScryfallCache): Promise<ScryfallCard | null> {
  const cached = cache.getMany([id]).get(id);
  if (cached) return cached;
  const fresh = await fetchCardsByIds([id], cache);
  return fresh[0] ?? null;
}

/**
 * POSTs a batch to Scryfall's collection endpoint with exponential backoff on 429s.
 * Returns the parsed response, or null after MAX_RETRIES.
 *
 * Honors the Retry-After header when present; otherwise doubles the wait each attempt
 * starting at MIN_BACKOFF_MS, capped at MAX_BACKOFF_MS.
 */
async function fetchBatchWithRetry(
  identifiers: Identifier[],
  batchNum: number
): Promise<CollectionResponse | null> {
  let backoff = MIN_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(SCRYFALL_COLLECTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'spellcontrol/1.0',
        },
        body: JSON.stringify({ identifiers }),
      });

      if (response.ok) {
        return (await response.json()) as CollectionResponse;
      }

      if (response.status === 429) {
        // Rate limited — wait and retry. Prefer the server's hint if it gave us one.
        const retryAfter = response.headers.get('Retry-After');
        const wait = retryAfter
          ? Math.min(MAX_BACKOFF_MS, parseRetryAfter(retryAfter))
          : Math.min(MAX_BACKOFF_MS, backoff);

        if (attempt === MAX_RETRIES) {
          logger.error(
            `[scryfall] batch ${batchNum} gave up after ${MAX_RETRIES} retries (still 429)`
          );
          return null;
        }

        logger.warn(
          `[scryfall] batch ${batchNum} hit 429, waiting ${wait}ms before retry ${attempt + 1}/${MAX_RETRIES}`
        );
        await sleep(wait);
        backoff *= 2;
        continue;
      }

      // Non-429 error — log and give up on this batch
      logger.error(`[scryfall] batch ${batchNum} failed: HTTP ${response.status}`);
      return null;
    } catch (err) {
      logger.error(`[scryfall] batch ${batchNum} network error:`, err);
      if (attempt === MAX_RETRIES) return null;
      await sleep(backoff);
      backoff *= 2;
    }
  }

  return null;
}

/** Retry-After can be either an HTTP date or seconds. We only handle seconds (Scryfall's case). */
function parseRetryAfter(header: string): number {
  const seconds = parseInt(header, 10);
  if (isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  return MIN_BACKOFF_MS;
}

// Key builders shared between runtime lookups (identifierKey) and bulk-ingest
// alias generation (cardAliasKeys) so the two can never drift. `name` is expected
// to already be the front face (see buildIdentifier / cardAliasKeys); set is
// lowercased here, collector is kept verbatim (it can carry letters/symbols).
const nsKeyFor = (name: string, set: string): string =>
  `ns:${name.toLowerCase()}|${set.toLowerCase()}`;
const nscKeyFor = (name: string, set: string, collector: string): string =>
  `nsc:${name.toLowerCase()}|${set.toLowerCase()}|${collector}`;

/**
 * Stable key for an identifier so multiple rows that ask for the same Scryfall lookup
 * can share a single resolution.
 */
function identifierKey(ident: Identifier): string {
  if ('id' in ident) return `id:${ident.id}`;
  const name = ident.name.toLowerCase();
  if ('collector_number' in ident && 'set' in ident) {
    return nscKeyFor(ident.name, ident.set, ident.collector_number);
  }
  if ('set' in ident) return nsKeyFor(ident.name, ident.set);
  return `n:${name}`;
}

/**
 * The alias keys a card should be cached under so a future name/set/collector
 * import row resolves to it from {@link ScryfallCache.getManyByKeys}. Mirrors the
 * keys {@link identifierKey} produces for the corresponding import-row identifiers
 * (front-face name, lowercased set). Used by the bulk-data ingest to pre-populate
 * the alias table.
 *
 * Deliberately omits the bare `n:` (name-only) key: a name maps to many printings
 * and Scryfall applies its own "best printing" heuristic for name-only lookups,
 * which we don't replicate. Bare-name rows keep falling back to the network (and
 * the resolved choice is then recorded lazily, preserving Scryfall's selection).
 */
export function cardAliasKeys(card: {
  name: string;
  set: string;
  collector_number?: string;
}): string[] {
  const frontName = card.name.split(' // ')[0].trim();
  if (!frontName || !card.set) return [];
  const keys = [nsKeyFor(frontName, card.set)];
  const collector = card.collector_number?.trim();
  if (collector) keys.push(nscKeyFor(frontName, card.set, collector));
  return keys;
}

/**
 * Picks the most-specific identifier for a given row. Returns null if there's not enough
 * info to do any kind of lookup.
 *
 * Multi-face card names are normalized to the front face. Scryfall's /cards/collection
 * endpoint returns not_found when a "Front // Back" name is sent for split / DFC /
 * adventure cards (Moxfield exports them in full form). The front face matches.
 */
function buildIdentifier(row: ImportRow): Identifier | null {
  if (row.scryfallId) return { id: row.scryfallId };
  if (!row.name) return null;

  const name = row.name.split(' // ')[0].trim();
  if (!name) return null;

  const set = row.setCode?.toLowerCase().trim();
  const collector = row.collectorNumber?.trim();

  if (set && collector) return { name, set, collector_number: collector };
  if (set) return { name, set };
  return { name };
}

/**
 * Verifies that a returned card actually matches the identifier we sent.
 * Scryfall is forgiving on input but its response carries the canonical fields, so we
 * sanity-check before claiming a match.
 */
/**
 * Fetches all paper printings of a card by name via Scryfall's search endpoint.
 * Returns an array of ScryfallCards sorted by release date (newest first).
 * Handles pagination — Scryfall caps search results at 175 per page.
 */
export async function fetchPrintings(cardName: string): Promise<ScryfallCard[]> {
  const frontFace = cardName.split(' // ')[0].trim();
  const query = `!"${frontFace}" game:paper unique:prints`;
  const all: ScryfallCard[] = [];
  let url: string | null =
    `${SCRYFALL_SEARCH_URL}?${new URLSearchParams({ q: query, order: 'released', dir: 'desc' })}`;

  while (url) {
    const result = await fetchSearchPageWithRetry(url);
    if (!result) break;
    all.push(...result.data);
    url = result.has_more && result.next_page ? result.next_page : null;
    if (url) await sleep(REQUEST_DELAY_MS);
  }

  return all;
}

interface SearchResponse {
  object: 'list';
  data: ScryfallCard[];
  has_more: boolean;
  next_page?: string;
}

async function fetchSearchPageWithRetry(url: string): Promise<SearchResponse | null> {
  let backoff = MIN_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'spellcontrol/1.0',
        },
      });

      if (response.ok) {
        return (await response.json()) as SearchResponse;
      }

      if (response.status === 404) {
        return null;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const wait = retryAfter
          ? Math.min(MAX_BACKOFF_MS, parseRetryAfter(retryAfter))
          : Math.min(MAX_BACKOFF_MS, backoff);
        if (attempt === MAX_RETRIES) return null;
        logger.warn(`[scryfall] search hit 429, waiting ${wait}ms`);
        await sleep(wait);
        backoff *= 2;
        continue;
      }

      logger.error(`[scryfall] search failed: HTTP ${response.status}`);
      return null;
    } catch (err) {
      logger.error('[scryfall] search network error:', err);
      if (attempt === MAX_RETRIES) return null;
      await sleep(backoff);
      backoff *= 2;
    }
  }

  return null;
}

function identifierMatchesCard(identifier: Identifier, card: ScryfallCard): boolean {
  if ('id' in identifier) {
    return card.id === identifier.id;
  }

  // Card data always carries the full "Front // Back" form for split / DFC / adventure cards.
  // We accept either the full name or the front face matching the input.
  const cardName = card.name.toLowerCase();
  const inputName = identifier.name.toLowerCase();
  const cardFrontFace = cardName.split(' // ')[0];
  const nameOk = cardName === inputName || cardFrontFace === inputName;
  if (!nameOk) return false;

  if ('set' in identifier && card.set.toLowerCase() !== identifier.set.toLowerCase()) {
    return false;
  }
  if ('collector_number' in identifier && card.collector_number !== identifier.collector_number) {
    return false;
  }

  return true;
}

interface RulingsResponse {
  object: 'list';
  data: Ruling[];
}

/**
 * Fetches a card's official rulings from Scryfall by Scryfall ID. Returns an
 * empty array when the card has no rulings or is unknown (404). Honors 429
 * backoff like the other Scryfall calls; throws only when it exhausts retries
 * so the route can surface a transient failure rather than a false "no rulings".
 */
export async function fetchRulings(id: string): Promise<Ruling[]> {
  let backoff = MIN_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`https://api.scryfall.com/cards/${id}/rulings`, {
        headers: { Accept: 'application/json', 'User-Agent': 'spellcontrol/1.0' },
      });

      if (response.ok) {
        const body = (await response.json()) as RulingsResponse;
        return body.data ?? [];
      }
      if (response.status === 404) return [];
      if (response.status === 429) {
        if (attempt === MAX_RETRIES) {
          logger.error(`[scryfall] fetchRulings(${id}) gave up after ${MAX_RETRIES} retries`);
          break;
        }
        const retryAfter = response.headers.get('Retry-After');
        const wait = retryAfter
          ? Math.min(MAX_BACKOFF_MS, parseRetryAfter(retryAfter))
          : Math.min(MAX_BACKOFF_MS, backoff);
        logger.warn(`[scryfall] fetchRulings(${id}) hit 429, waiting ${wait}ms`);
        await sleep(wait);
        backoff *= 2;
        continue;
      }
      logger.error(`[scryfall] fetchRulings(${id}) failed: HTTP ${response.status}`);
      break;
    } catch (err) {
      logger.error(`[scryfall] fetchRulings(${id}) network error:`, err);
      break;
    }
  }
  throw new Error(`fetchRulings(${id}) exhausted retries`);
}
