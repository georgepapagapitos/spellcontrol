import type { ScryfallCard } from './types';
import type { ScryfallCache } from './cache';
import type { ImportRow } from './parsers/types';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75;
/** Scryfall asks for 50–100ms between requests, but tightens this under sustained load. */
const REQUEST_DELAY_MS = 250;
/** When we hit a 429, wait at least this long before retrying (we also honor Retry-After). */
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
export async function resolveCards(
  rows: ImportRow[],
  cache: ScryfallCache
): Promise<LookupResult> {
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

  if (identifierByKey.size === 0) {
    return { resolved, unresolvedNames: [] };
  }

  console.log(
    `[scryfall] resolving ${identifierByKey.size} unique identifiers across ${rows.length} rows`
  );

  // Step 3: batch the remaining identifiers. We send each unique identifier exactly once.
  const pendingEntries = Array.from(identifierByKey.entries());

  for (let i = 0; i < pendingEntries.length; i += BATCH_SIZE) {
    const batch = pendingEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE);

    const json = await fetchBatchWithRetry(
      batch.map(([, ident]) => ident),
      batchNum
    );

    if (!json) {
      console.warn(`[scryfall] batch ${batchNum} returned no data, skipping ${batch.length} identifiers`);
      continue;
    }

    for (const [key, ident] of batch) {
      const card = json.data.find((c) => identifierMatchesCard(ident, c));
      if (card) {
        for (const rowIdx of rowIdxsByKey.get(key)!) {
          resolved[rowIdx] = card;
        }
      }
    }
    if (json.data.length > 0) {
      cache.setMany(json.data);
    }

    if (i + BATCH_SIZE < pendingEntries.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Step 4: collect names of rows that never resolved.
  const unresolvedNames: string[] = [];
  rows.forEach((row, i) => {
    if (!resolved[i] && row.name) unresolvedNames.push(row.name);
  });

  return { resolved, unresolvedNames };
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
          'User-Agent': 'mtg-binder-planner/1.0',
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
          console.error(
            `[scryfall] batch ${batchNum} gave up after ${MAX_RETRIES} retries (still 429)`
          );
          return null;
        }

        console.warn(
          `[scryfall] batch ${batchNum} hit 429, waiting ${wait}ms before retry ${attempt + 1}/${MAX_RETRIES}`
        );
        await sleep(wait);
        backoff *= 2;
        continue;
      }

      // Non-429 error — log and give up on this batch
      console.error(`[scryfall] batch ${batchNum} failed: HTTP ${response.status}`);
      return null;
    } catch (err) {
      console.error(`[scryfall] batch ${batchNum} network error:`, err);
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

/**
 * Stable key for an identifier so multiple rows that ask for the same Scryfall lookup
 * can share a single resolution.
 */
function identifierKey(ident: Identifier): string {
  if ('id' in ident) return `id:${ident.id}`;
  const name = ident.name.toLowerCase();
  if ('collector_number' in ident && 'set' in ident) {
    return `nsc:${name}|${ident.set.toLowerCase()}|${ident.collector_number}`;
  }
  if ('set' in ident) return `ns:${name}|${ident.set.toLowerCase()}`;
  return `n:${name}`;
}

/**
 * Picks the most-specific identifier for a given row. Returns null if there's not enough
 * info to do any kind of lookup.
 */
function buildIdentifier(row: ImportRow): Identifier | null {
  if (row.scryfallId) return { id: row.scryfallId };
  if (!row.name) return null;

  const set = row.setCode?.toLowerCase().trim();
  const collector = row.collectorNumber?.trim();

  if (set && collector) return { name: row.name, set, collector_number: collector };
  if (set) return { name: row.name, set };
  return { name: row.name };
}

/**
 * Verifies that a returned card actually matches the identifier we sent.
 * Scryfall is forgiving on input but its response carries the canonical fields, so we
 * sanity-check before claiming a match.
 */
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
