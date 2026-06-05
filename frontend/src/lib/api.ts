import { useEffect, useState } from 'react';
import type {
  DeckImportResponse,
  ProductResolveResponse,
  ProductSummary,
  UploadResponse,
} from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { handleResponse } from './fetch-utils';
import { apiUrl } from './api-base';
import { chunkImportText } from './import-chunker';
import { mergeUploadResponses } from './merge-upload-responses';

const TIMEOUT_MS = 120_000;
const IMPORT_CHUNK_SIZE = 500;
/**
 * How many import chunks we upload at once. Concurrency overlaps the per-chunk
 * round trips (each chunk does its own server-side Scryfall resolution), cutting
 * wall-clock on large imports. Kept modest so we don't fan out so hard that the
 * backend trips Scryfall's rate limit; the server-side cache + 429 backoff absorb
 * the rest.
 */
const IMPORT_CHUNK_CONCURRENCY = 3;

// Retry transient network failures on import-chunk uploads. Each entry is the
// delay before the next attempt; an empty array would mean no retry. Tests run
// with zero delays so the suite stays fast.
const IMPORT_RETRY_DELAYS_MS: readonly number[] =
  import.meta.env.MODE === 'test' ? [0, 0] : [1500, 4000];

const sleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));

interface NetworkError extends Error {
  isNetworkError: true;
}

function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof Error && (err as Partial<NetworkError>).isNetworkError === true;
}

function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(apiUrl(url), { ...opts, signal: controller.signal })
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error(
          'The request timed out. This can happen with very large collections. Try importing a smaller batch.'
        );
      }
      // Any other rejection — DNS, connection reset, TLS, the browser killing
      // a long-running fetch (mobile tab suspension, cellular handoff). Tag so
      // the import-chunk caller knows it's safe to retry.
      const e: NetworkError = Object.assign(
        new Error('The server is not responding. Give it a moment and try again.'),
        { isNetworkError: true as const }
      );
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

export interface ImportProgress {
  /** 1-indexed chunk currently being uploaded. */
  chunkIndex: number;
  /** Total number of chunks. 1 means the file fit in a single request. */
  totalChunks: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

async function postImportChunk(text: string): Promise<UploadResponse> {
  const response = await fetchWithTimeout('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handleResponse<UploadResponse>(response);
}

async function postImportChunkWithRetry(text: string): Promise<UploadResponse> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await postImportChunk(text);
    } catch (err) {
      lastErr = err;
      // Only retry transient network failures. HTTP 4xx/5xx from the server
      // (parser errors, rate limiting, oversize body) come through as normal
      // errors and should surface immediately.
      if (!isNetworkError(err) || attempt >= IMPORT_RETRY_DELAYS_MS.length) break;
      await sleep(IMPORT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

/**
 * Import via pasted text or a file's text contents.
 *
 * Big collections (1k+ rows) are split into chunks of {@link IMPORT_CHUNK_SIZE}
 * lines and uploaded with up to {@link IMPORT_CHUNK_CONCURRENCY} in flight at
 * once. Each chunk gets its own retry budget so a transient network failure (tab
 * suspended, cellular handoff, NAT timeout) only restarts that one chunk instead
 * of the whole import. Header rows in CSV/TSV/ManaBox files are preserved in every
 * chunk so each is independently parseable.
 *
 * **Atomicity contract** (relied on by UploadPanel and any future caller):
 * the function either resolves with the merged UploadResponse for ALL
 * chunks, or throws. Successful intermediate chunks are accumulated only
 * in this function's local `responses` array — they MUST NOT be exposed
 * to the caller on a later chunk's failure, and the backend `/api/import`
 * route is stateless (no per-chunk server-side persistence) so a partial
 * upload leaves no orphaned state on either side. Callers (UploadPanel)
 * therefore only need to call `importCards()` once with the resolved
 * response and don't need to roll back on failure.
 */
export async function importText(
  text: string,
  onProgress?: ImportProgressCallback
): Promise<UploadResponse> {
  const chunks = chunkImportText(text, IMPORT_CHUNK_SIZE);
  if (chunks.length === 1) {
    onProgress?.({ chunkIndex: 1, totalChunks: 1 });
    return postImportChunkWithRetry(text);
  }

  // Upload chunks with bounded concurrency. Results are kept in input order so the
  // merge is deterministic; progress reports the number completed so far. Atomicity:
  // any chunk failure rejects the whole import and the partial `responses` array is
  // never exposed (the backend is stateless across chunks, so nothing to roll back).
  const responses: UploadResponse[] = new Array(chunks.length);
  let completed = 0;
  let nextChunk = 0;

  const worker = async (): Promise<void> => {
    for (let i = nextChunk++; i < chunks.length; i = nextChunk++) {
      try {
        responses[i] = await postImportChunkWithRetry(chunks[i]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw new Error(`Import failed on batch ${i + 1} of ${chunks.length}: ${message}`);
      }
      completed++;
      onProgress?.({ chunkIndex: completed, totalChunks: chunks.length });
    }
  };

  const workerCount = Math.min(IMPORT_CHUNK_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return mergeUploadResponses(responses);
}

/**
 * Import via file upload. Reads the file as text and dispatches to
 * {@link importText} so chunked imports work uniformly on web and native.
 * The backend's multipart route still exists but only the text-JSON path is
 * exercised from the client now — chunkable, retry-friendly, and consistent
 * across platforms (CapacitorHttp's multipart bridge on native was unreliable
 * anyway).
 */
export async function importFile(
  file: File,
  onProgress?: ImportProgressCallback
): Promise<UploadResponse> {
  return importText(await file.text(), onProgress);
}

interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
}
export type SetMap = Record<string, SetSummary>;

let setMapPromise: Promise<SetMap> | null = null;

/** Fetches the Scryfall set list (cached per page-load). Resolves to a map keyed by uppercase set code. */
export function getSetMap(): Promise<SetMap> {
  if (!setMapPromise) {
    setMapPromise = fetchWithTimeout('/api/sets', { method: 'GET' })
      .then((r) => handleResponse<{ sets: SetMap }>(r))
      .then((j) => j.sets)
      .catch((err) => {
        setMapPromise = null;
        throw err;
      });
  }
  return setMapPromise;
}

/** React hook that resolves the set map once per mount (cached globally). */
export function useSetMap(): SetMap | undefined {
  const [map, setMap] = useState<SetMap | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

/** Import a deck from pasted text. Returns ScryfallCard objects grouped by section. */
export async function importDeckText(text: string): Promise<DeckImportResponse> {
  const response = await fetchWithTimeout('/api/import-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handleResponse<DeckImportResponse>(response);
}

/**
 * Searches the MTGJSON product catalog (T17). `type` filters by MTGJSON product
 * type (e.g. "Commander Deck"). Returns lightweight summaries for the picker.
 */
export async function searchProducts(query: string, type?: string): Promise<ProductSummary[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (type) params.set('type', type);
  const response = await fetchWithTimeout(`/api/products?${params.toString()}`, { method: 'GET' });
  const data = await handleResponse<{ products: ProductSummary[] }>(response);
  return data.products;
}

/** Resolves a single product's full decklist (playable deck + physical extras). */
export async function fetchProduct(fileName: string): Promise<ProductResolveResponse> {
  const response = await fetchWithTimeout(`/api/products/${encodeURIComponent(fileName)}`, {
    method: 'GET',
  });
  return handleResponse<ProductResolveResponse>(response);
}

/** Import a deck from a file upload. Returns ScryfallCard objects grouped by section. */
export async function importDeckFile(file: File): Promise<DeckImportResponse> {
  // Same as importFile — read text and post JSON. Deck imports are small
  // (one deck, ~100 rows) so chunking isn't needed; we still go through the
  // text path for consistency across platforms.
  return importDeckText(await file.text());
}

/** Fetch all printings of a card by name. */
export async function fetchPrintings(cardName: string): Promise<ScryfallCard[]> {
  const encoded = encodeURIComponent(cardName);
  const response = await fetchWithTimeout(`/api/cards/${encoded}/printings`, { method: 'GET' });
  const data = await handleResponse<{ printings: ScryfallCard[] }>(response);
  return data.printings;
}

/**
 * Fetch a single card by Scryfall id. Used by the v2 camera scanner to
 * resolve the matcher's UUID output into a renderable ScryfallCard.
 * Cache-backed on the server so repeated scans don't fan out to Scryfall.
 * Returns null when the server says Scryfall doesn't know the id.
 */
export async function getCardById(id: string): Promise<ScryfallCard | null> {
  const response = await fetchWithTimeout(`/api/cards/by-id/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  const data = await handleResponse<{ card: ScryfallCard | null }>(response);
  return data.card;
}
