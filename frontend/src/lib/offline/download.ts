import { readManifest, replaceOracleCards, writeManifest } from './db';
import { importCombos } from './combos-import';
import type { OfflineManifest, SlimCard } from './types';
import { apiUrl } from '../api-base';

export type DownloadPhase =
  | 'idle'
  | 'fetching-manifest'
  | 'waiting-for-server'
  | 'downloading-cards'
  | 'storing-cards'
  | 'downloading-combos'
  | 'storing-combos'
  | 'done'
  | 'error';

export interface DownloadProgress {
  phase: DownloadPhase;
  // 0..1 within the current phase; or null if indeterminate.
  fraction: number | null;
  // Optional human-readable detail (e.g. "12345 / 30000 cards").
  detail?: string;
}

export type ProgressFn = (p: DownloadProgress) => void;

/**
 * Status codes that mean "come back soon", as opposed to "this failed".
 *
 * 503 is what our backend returns intentionally while the bulk warms; 502/504
 * are what nginx returns when an upstream is slow or unreachable (server boot
 * is still warming). 429 belongs here for the same reason and is the one that
 * bites hardest: `/api/offline/manifest` is rate-limited, and the warm-up path
 * below is exactly what bunches requests together — every client on a venue's
 * shared address enters this loop at once after a deploy. Treating 429 as
 * fatal turned "wait a moment" into "Couldn't reach the card data service" for
 * all of them. `Retry-After` (which express-rate-limit sets) is honoured below,
 * and the exponential backoff is the fallback when it is absent.
 */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Total wall-clock cap on a single sync attempt's manifest-warm-up retries. */
const MAX_RETRY_WINDOW_MS = 180_000; // 3 minutes — server usually warms in <60s
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;

function parseRetryAfter(headerVal: string | null): number | null {
  if (!headerVal) return null;
  // RFC 7231: either an integer (seconds) or an HTTP-date. We only emit the
  // integer form server-side, but handle both defensively.
  const secs = Number(headerVal);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const ts = Date.parse(headerVal);
  return Number.isFinite(ts) ? Math.max(0, ts - Date.now()) : null;
}

async function fetchManifest(onProgress?: ProgressFn): Promise<OfflineManifest> {
  const started = Date.now();
  let backoffMs = INITIAL_BACKOFF_MS;
  let attempt = 0;
  while (true) {
    attempt += 1;
    // Network-layer failures (DNS down, browser offline) bubble up as
    // thrown errors — those aren't retryable from this layer; the caller
    // surfaces them as a sync error.
    const res = await fetch(apiUrl('/api/offline/manifest'), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) return (await res.json()) as OfflineManifest;
    if (!RETRYABLE_STATUSES.has(res.status) || Date.now() - started > MAX_RETRY_WINDOW_MS) {
      throw new Error("Couldn't reach the card data service. Try again in a moment.");
    }
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    const wait = retryAfter ?? backoffMs;
    onProgress?.({
      phase: 'waiting-for-server',
      fraction: null,
      detail: `Server is preparing data (attempt ${attempt})… retrying in ${Math.round(wait / 1000)}s`,
    });
    await sleep(wait);
    backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithProgress<T>(
  url: string,
  expectedBytes: number | null,
  onBytes?: (downloaded: number, total: number | null) => void
): Promise<T> {
  // The server sends gzipped bodies with `Content-Encoding: gzip`; the browser
  // transparently decodes. The reported Content-Length is the *compressed*
  // size, which is exactly what we want for the progress bar's denominator.
  const res = await fetch(apiUrl(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error("Couldn't download the card data. Try again in a moment.");
  }
  const headerLen = res.headers.get('Content-Length');
  const total = headerLen ? parseInt(headerLen, 10) : expectedBytes;

  if (!res.body) {
    // Fallback: no streaming reader (older browsers, undici quirks).
    onBytes?.(0, total);
    const json = (await res.json()) as T;
    onBytes?.(total ?? 0, total);
    return json;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onBytes?.(received, total);
    }
  }
  // Reassemble. The browser already decompressed if Content-Encoding was set,
  // so this is plain UTF-8 JSON text.
  let combinedLength = 0;
  for (const c of chunks) combinedLength += c.byteLength;
  const combined = new Uint8Array(combinedLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder('utf-8').decode(combined);
  return JSON.parse(text) as T;
}

/**
 * Sync the offline dataset to the latest server version. Idempotent: if the
 * local manifest already matches the server manifest, returns early. The
 * combos and cards bulks are downloaded separately so a partial failure on
 * one doesn't waste the other.
 */
export async function syncOfflineData(opts: {
  force?: boolean;
  onProgress?: ProgressFn;
}): Promise<{ manifest: OfflineManifest; updated: boolean }> {
  const { force = false, onProgress } = opts;

  onProgress?.({ phase: 'fetching-manifest', fraction: null });
  const server = await fetchManifest(onProgress);
  const local = await readManifest();

  const cardsUpToDate =
    !force && local?.oracleVersion === server.oracleVersion && local?.oracleCardCount;
  const combosUpToDate =
    !force && local?.combosVersion === server.combosVersion && local?.combosCount;

  if (cardsUpToDate && combosUpToDate) {
    onProgress?.({ phase: 'done', fraction: 1 });
    return { manifest: server, updated: false };
  }

  if (!cardsUpToDate) {
    onProgress?.({
      phase: 'downloading-cards',
      fraction: 0,
      detail: `0 / ${(server.oracleByteSize / 1_000_000).toFixed(1)} MB`,
    });
    const cards = await fetchJsonWithProgress<SlimCard[]>(
      '/api/offline/oracle-cards',
      server.oracleByteSize,
      (downloaded, total) => {
        onProgress?.({
          phase: 'downloading-cards',
          fraction: total ? downloaded / total : null,
          detail: `${(downloaded / 1_000_000).toFixed(1)} / ${total ? (total / 1_000_000).toFixed(1) : '?'} MB`,
        });
      }
    );

    onProgress?.({ phase: 'storing-cards', fraction: 0, detail: `0 / ${cards.length}` });
    await replaceOracleCards(cards, (done, total) => {
      onProgress?.({
        phase: 'storing-cards',
        fraction: total ? done / total : null,
        detail: `${done} / ${total} cards`,
      });
    });

    // Persist the oracle version now, keeping combos at their old (local)
    // values, so a failure in the combos phase below doesn't discard the
    // just-stored cards and force a full re-download on the next resume (F15).
    await writeManifest({
      ...server,
      combosVersion: local?.combosVersion ?? '',
      combosCount: local?.combosCount ?? 0,
      combosByteSize: local?.combosByteSize ?? 0,
      combosUpdatedAt: local?.combosUpdatedAt ?? 0,
    });
  }

  if (!combosUpToDate) {
    onProgress?.({
      phase: 'downloading-combos',
      fraction: 0,
      detail: `0 / ${(server.combosByteSize / 1_000_000).toFixed(2)} MB`,
    });
    // Streams NDJSON and stores rows as they arrive, so downloading and
    // storing are one phase. `received` counts decoded bytes while the
    // manifest's size is the gzipped transfer, so the fraction is a guide
    // (clamped), not a measurement.
    await importCombos((received) => {
      const total = server.combosByteSize || null;
      onProgress?.({
        phase: 'downloading-combos',
        fraction: total ? Math.min(1, received / total) : null,
        detail: `${(received / 1_000_000).toFixed(2)} / ${total ? (total / 1_000_000).toFixed(2) : '?'} MB`,
      });
    }, server.combosVersion);
  }

  await writeManifest(server);
  onProgress?.({ phase: 'done', fraction: 1 });
  return { manifest: server, updated: true };
}
