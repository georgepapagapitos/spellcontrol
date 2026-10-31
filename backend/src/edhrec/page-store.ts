import { gunzipSync, gzipSync } from 'node:zlib';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { edhrecPages } from '../db/schema-edhrec-pages';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { pageShapeProblem, type EdhrecPageRef } from './page-paths';

/**
 * Serves EDHREC's per-page JSON (commander, theme, tag, card, combo, salt
 * pages) from our own Postgres copy, so the browser never calls json.edhrec.com
 * and a CORS change, a rate limit or a broken page on their side cannot take
 * deck generation down for everyone. Top lists have their own store
 * (top-store.ts); this is the rest of what edhrec/client.ts reads.
 *
 * - fresh (fetched within FRESH_MS): served as stored, no EDHREC call;
 * - stale or missing: fetched now. A body that fetches and passes the shape
 *   floor replaces the copy. A failed fetch, or a body that fails the floor,
 *   keeps the last good copy and serves it marked stale; the next attempt waits
 *   RETRY_MS so an outage costs one request per page per 15 minutes;
 * - missing and failing: PageUnavailableError (the route's 503, which the
 *   browser client retries with its usual backoff and then reads as a failure).
 *   A body that fetched fine but fails the floor, with no good copy to fall
 *   back to, is passed through unstored as `unvalidated`: no worse than the
 *   browser fetching it directly, and the client's drift tripwire still sees it.
 *
 * EDHREC answering 403/404 means "no such page" (a new commander has no combos
 * page, a tag has no color page). That is passed through with its status and
 * remembered in memory for NEGATIVE_MS, so a missing page costs one upstream
 * call per hour, not one per generation.
 *
 * Bytes are stored exactly as EDHREC sent them (gzipped), so what the browser
 * parses is byte-identical to a direct fetch. Total stored size is bounded by
 * MAX_TOTAL_BYTES, evicting the least recently served pages first.
 */

export const FRESH_MS = 24 * 60 * 60 * 1000;
export const RETRY_MS = 15 * 60 * 1000;
export const NEGATIVE_MS = 60 * 60 * 1000;
/** A failed cold fetch is remembered briefly so the browser's own retries
 *  don't each start a full upstream retry cycle. */
export const FAILURE_MS = 30 * 1000;
/** Stored (compressed) bytes across all pages. A commander page is roughly
 *  60 KB gzipped, so the default holds on the order of 1,500 pages. */
export const DEFAULT_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const NEGATIVE_MAX_ENTRIES = 5000;
const SERVED_TOUCH_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
const EDHREC_BASE = 'https://json.edhrec.com';
// The default undici UA was bot-blocked on another host (rules/ingest.ts).
const USER_AGENT = 'SpellControl/1.0 (+https://spellcontrol.com)';

/** Mutable so tests can run without real waits. */
export const tuning = {
  /** Minimum gap between ANY two upstream requests (the global rate limit). */
  upstreamGapMs: 250,
  /** Retries after a 429/5xx/network error, with exponential backoff. */
  maxRetries: 3,
  backoffMs: 1000,
  maxRetryAfterMs: 10_000,
  maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
};

export class PageUnavailableError extends Error {}

export type PageState = 'hit' | 'miss' | 'stale' | 'unvalidated';

export type PageResult =
  | { kind: 'page'; state: PageState; gz: Buffer; fetchedAt: number }
  | { kind: 'absent'; status: 403 | 404 };

// -- upstream: one request at a time spaced by upstreamGapMs, with backoff --

let gate: Promise<void> = Promise.resolve();

function takeTurn(): Promise<void> {
  const turn = gate;
  gate = turn.then(() => new Promise<void>((r) => setTimeout(r, tuning.upstreamGapMs)));
  return turn;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Upstream {
  status: number;
  text: string;
}

async function fetchUpstream(path: string): Promise<Upstream> {
  let lastError = 'no attempt';
  for (let attempt = 0; attempt <= tuning.maxRetries; attempt++) {
    await takeTurn();
    let res: Response;
    try {
      res = await fetch(`${EDHREC_BASE}${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = errorMessage(err);
      if (attempt < tuning.maxRetries) await sleep(tuning.backoffMs * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = `EDHREC answered ${res.status}`;
      await res.body?.cancel();
      if (attempt < tuning.maxRetries) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, tuning.maxRetryAfterMs)
            : tuning.backoffMs * 2 ** attempt;
        await sleep(wait);
      }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { status: res.status, text: '' };
    }
    const text = await res.text();
    if (text.length > MAX_UPSTREAM_BYTES) throw new Error('EDHREC page is too large');
    return { status: res.status, text };
  }
  throw new Error(lastError);
}

// -- in-memory negative / failure memory --

const absent = new Map<string, { status: 403 | 404; until: number }>();
const failed = new Map<string, number>();

function rememberAbsent(path: string, status: 403 | 404, now: number): void {
  if (absent.size >= NEGATIVE_MAX_ENTRIES) absent.clear();
  absent.set(path, { status, until: now + NEGATIVE_MS });
}

/** Tests only. */
export function resetPageMemory(): void {
  absent.clear();
  failed.clear();
  loading.clear();
  gate = Promise.resolve();
}

// -- storage --

interface PageRow {
  gz: Buffer;
  fetchedAt: number;
  checkedAt: number;
  servedAt: number;
}

async function readRow(path: string): Promise<PageRow | null> {
  const [row] = await getDb().select().from(edhrecPages).where(eq(edhrecPages.path, path)).limit(1);
  return row
    ? { gz: row.body, fetchedAt: row.fetchedAt, checkedAt: row.checkedAt, servedAt: row.servedAt }
    : null;
}

/** Drops the least recently served pages until the total fits the bound.
 *  The page just written has the newest served_at and is row 1, which is never
 *  dropped, so the table can exceed the bound by at most that one page. */
export async function evictToBound(): Promise<number> {
  const res = await getDb().execute(sql`
    DELETE FROM edhrec_pages WHERE path IN (
      SELECT path FROM (
        SELECT path, SUM(bytes) OVER (ORDER BY served_at DESC, path) AS running,
               ROW_NUMBER() OVER (ORDER BY served_at DESC, path) AS rn
        FROM edhrec_pages
      ) t WHERE running > ${tuning.maxTotalBytes} AND rn > 1
    )`);
  return res.rowCount ?? 0;
}

async function store(path: string, gz: Buffer, now: number): Promise<void> {
  await getDb()
    .insert(edhrecPages)
    .values({ path, body: gz, bytes: gz.length, fetchedAt: now, checkedAt: now, servedAt: now })
    .onConflictDoUpdate({
      target: edhrecPages.path,
      set: { body: gz, bytes: gz.length, fetchedAt: now, checkedAt: now, servedAt: now },
    });
  const dropped = await evictToBound();
  if (dropped > 0)
    logger.info(`[edhrec-pages] evicted ${dropped} page(s) to stay under the size bound`);
}

async function markChecked(path: string, now: number): Promise<void> {
  await getDb().update(edhrecPages).set({ checkedAt: now }).where(eq(edhrecPages.path, path));
}

/** Records a serve, at most once an hour per page, so a hot page isn't a write per request. */
function touch(path: string, row: PageRow, now: number): void {
  if (now - row.servedAt < SERVED_TOUCH_MS) return;
  void getDb()
    .update(edhrecPages)
    .set({ servedAt: now })
    .where(eq(edhrecPages.path, path))
    .catch((err: unknown) => logger.warn(`[edhrec-pages] touch failed: ${errorMessage(err)}`));
}

// -- the load --

async function refresh(ref: EdhrecPageRef, row: PageRow | null, now: number): Promise<PageResult> {
  const { path } = ref;
  let up: Upstream;
  try {
    up = await fetchUpstream(path);
  } catch (err) {
    return fallBack(ref, row, now, `fetch failed: ${errorMessage(err)}`);
  }

  if (up.status === 403 || up.status === 404) {
    // A stored page that EDHREC now says doesn't exist is still the last good
    // copy; serve it stale rather than turn a page into "no page".
    if (row) return fallBack(ref, row, now, `EDHREC answered ${up.status} for a stored page`);
    rememberAbsent(path, up.status, now);
    return { kind: 'absent', status: up.status };
  }
  if (up.status !== 200) {
    return fallBack(ref, row, now, `EDHREC answered ${up.status}`);
  }

  let problem: string | null;
  try {
    problem = pageShapeProblem(ref.kind, JSON.parse(up.text));
  } catch {
    problem = 'body is not JSON';
  }
  const gz = gzipSync(Buffer.from(up.text, 'utf8'));
  if (problem) {
    if (row) return fallBack(ref, row, now, `new body failed the shape check: ${problem}`);
    logger.warn(
      `[edhrec-pages] ${path}: body failed the shape check (${problem}) and there is no stored copy; passing it through unstored`
    );
    return { kind: 'page', state: 'unvalidated', gz, fetchedAt: now };
  }
  await store(path, gz, now);
  return { kind: 'page', state: 'miss', gz, fetchedAt: now };
}

async function fallBack(
  ref: EdhrecPageRef,
  row: PageRow | null,
  now: number,
  why: string
): Promise<PageResult> {
  if (row) {
    logger.warn(
      `[edhrec-pages] ${ref.path}: ${why}; serving the copy from ${new Date(row.fetchedAt).toISOString()}`
    );
    await markChecked(ref.path, now).catch(() => undefined);
    return { kind: 'page', state: 'stale', gz: row.gz, fetchedAt: row.fetchedAt };
  }
  logger.warn(`[edhrec-pages] ${ref.path}: ${why}; no stored copy`);
  failed.set(ref.path, now + FAILURE_MS);
  throw new PageUnavailableError(`${ref.path}: ${why}`);
}

/** One load per page at a time: the stored-copy read AND any fetch it starts,
 *  so concurrent requests for a cold or stale page share one upstream call. */
const loading = new Map<string, Promise<PageResult>>();

export function getPage(ref: EdhrecPageRef, now = Date.now()): Promise<PageResult> {
  const running = loading.get(ref.path);
  if (running) return running;
  const run = load(ref, now);
  loading.set(ref.path, run);
  void run.then(
    () => loading.delete(ref.path),
    () => loading.delete(ref.path)
  );
  return run;
}

async function load(ref: EdhrecPageRef, now: number): Promise<PageResult> {
  const { path } = ref;
  const no = absent.get(path);
  if (no && no.until > now) return { kind: 'absent', status: no.status };

  const row = await readRow(path);
  if (row && now - row.fetchedAt < FRESH_MS) {
    touch(path, row, now);
    return { kind: 'page', state: 'hit', gz: row.gz, fetchedAt: row.fetchedAt };
  }
  if (row && now - row.checkedAt < RETRY_MS) {
    // Stale, and an attempt already failed recently: don't ask EDHREC again yet.
    touch(path, row, now);
    return { kind: 'page', state: 'stale', gz: row.gz, fetchedAt: row.fetchedAt };
  }
  const cooling = failed.get(path);
  if (!row && cooling && cooling > now) {
    throw new PageUnavailableError(`${path}: a fetch failed moments ago`);
  }
  return refresh(ref, row, now);
}

export function gunzipPage(gz: Buffer): Buffer {
  return gunzipSync(gz);
}
