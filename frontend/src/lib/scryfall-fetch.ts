/**
 * The one Scryfall request path for the whole app: a single shared rate
 * limiter and a single 429/503 backoff policy.
 *
 * Why this is its own module rather than a private helper in the deck-builder
 * client: every Scryfall caller has to share *one* limiter, and a 429 has to
 * park *all* of them — not just the request that happened to be rejected.
 * Before this, each call site owned its own retry branch, so a throttled deck
 * generation had dozens of in-flight requests each backing off on their own
 * while the shared limiter kept handing out a slot every 100ms. The burst went
 * right on striking through the whole cooldown and the block deepened.
 * `RateLimiter.cooldown()` is the fix: one 429 parks the entire queue.
 */
import { logger } from '@/lib/logger';

export const SCRYFALL_BASE_URL = import.meta.env.DEV ? '/scryfall-api' : 'https://api.scryfall.com';

const MIN_REQUEST_DELAY = 100; // 100ms between requests (Scryfall allows 10/sec)
const MAX_RETRIES = 4; // cap 429/503 retries so a sustained throttle or outage fails instead of hanging
// A CORS-blocked 429 is indistinguishable from a dead network at the API level,
// so it gets its own much smaller budget: enough to park the shared queue, not
// enough to hold a spinner ~15s when the device really is unreachable.
const MAX_OPAQUE_RETRIES = 1;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000; // ceiling on *computed* backoff; an explicit Retry-After is always honored in full
const JITTER_MS = 250;

// Ceil: jitter makes the wait fractional, and a timer that fires a fraction of
// a millisecond short of `cooldownUntil` sends processQueue round again for the
// remainder — forever, since the clock can't advance by less than 1ms.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.ceil(ms)));

/**
 * Queue-based rate limiter that ensures requests are properly spaced.
 * All Scryfall requests MUST go through this to prevent 429 errors.
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private lastRequestTime = 0;
  private cooldownUntil = 0;

  /**
   * Wait for permission to make a request.
   * Returns a promise that resolves when it's safe to send.
   */
  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      void this.processQueue();
    });
  }

  /**
   * Park every pending and future acquire until `now + ms`. Idempotent — only
   * ever extends the cooldown, so concurrent 429s combine instead of racing.
   */
  cooldown(ms: number): void {
    const target = Date.now() + Math.max(0, ms);
    if (target > this.cooldownUntil) this.cooldownUntil = target;
  }

  /** Drop the cooldown/spacing state. Tests only — a cooldown set under fake
   *  timers would otherwise stall the next test for real seconds. */
  reset(): void {
    this.cooldownUntil = 0;
    this.lastRequestTime = 0;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Cooldown before spacing — one 429 holds the whole burst, not just the
      // request that earned it.
      if (now < this.cooldownUntil) {
        await sleep(this.cooldownUntil - now);
        continue;
      }

      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
        await sleep(MIN_REQUEST_DELAY - timeSinceLastRequest);
        // Re-check from the top: a 429 can land *while* we're spacing, and the
        // request we're about to release must be parked by it too.
        continue;
      }

      this.lastRequestTime = Date.now();
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }

    this.processing = false;
  }
}

const rateLimiter = new RateLimiter();

/** Test hook — see `RateLimiter.reset`. */
export function resetScryfallRateLimit(): void {
  rateLimiter.reset();
}

/**
 * Running tally of what we actually asked Scryfall for.
 *
 * This exists to answer one question with a number instead of a feeling: is a
 * deck generation still firing hundreds of requests, and is Scryfall still
 * throttling us? Client-side 429s never reach our server, so without this we
 * are blind — and "requests per cold generation" is the figure that decides
 * whether it's worth serving card data from the bulk dump we already ingest
 * nightly (`backend/src/scryfall-bulk.ts`) instead of from the public API.
 *
 * A single counter is only possible because `scryfallRequest` is the app's one
 * choke point. Don't add a second tally somewhere else — extend this.
 */
export interface ScryfallStats {
  /** HTTP requests actually sent, retries included. */
  requests: number;
  /** Responses that came back 429. */
  throttled: number;
  /**
   * Requests that failed opaquely while the device reported itself online —
   * almost always a CORS-blocked 429 (see {@link scryfallRequest}). Counted
   * apart from `throttled` because we never actually saw a status code.
   */
  blocked: number;
  /** Responses that came back 503. */
  unavailable: number;
  /** Requests that burned every retry and returned a failing response. */
  gaveUp: number;
  /** Total time the shared cooldown parked the queue, in ms. */
  cooldownMs: number;
}

const stats: ScryfallStats = {
  requests: 0,
  throttled: 0,
  blocked: 0,
  unavailable: 0,
  gaveUp: 0,
  cooldownMs: 0,
};

/** Snapshot of the tally since process start (or the last reset). */
export function getScryfallStats(): ScryfallStats {
  return { ...stats };
}

/** Zero the tally — call before a run you want to measure in isolation. */
export function resetScryfallStats(): void {
  stats.requests = 0;
  stats.throttled = 0;
  stats.blocked = 0;
  stats.unavailable = 0;
  stats.gaveUp = 0;
  stats.cooldownMs = 0;
}

// Reachable from the devtools console during a real deck generation:
//   __scryfallStats()            → the tally so far
//   __resetScryfallStats()       → zero it, then generate, then read again
// Dev only; never shipped to production users.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__scryfallStats = getScryfallStats;
  (window as unknown as Record<string, unknown>).__resetScryfallStats = resetScryfallStats;
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110). We only
 * parsed the numeric form, so a dated header read as `NaN` and we fell back to
 * our own backoff — ignoring the one authoritative answer to "how long?".
 * Returns milliseconds, or null when there's no usable header.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Rate-limited `fetch` against Scryfall, retrying 429 (throttled) and 503
 * (briefly overloaded). Every retry sets the shared cooldown, so concurrent
 * callers back off too. Capped at MAX_RETRIES so a sustained throttle or an
 * outage returns the failing response instead of hanging deck generation.
 *
 * Network-level failures (offline, DNS, dev-proxy down) reject as they would
 * from a bare `fetch` — callers already handle those their own way — but see
 * the opaque-throttle handling below for why a rejection can't be taken at face
 * value while the device is online.
 */
export async function scryfallRequest(path: string, init?: RequestInit): Promise<Response> {
  let opaqueFailures = 0;

  for (let attempt = 0; ; attempt++) {
    await rateLimiter.acquire();
    stats.requests += 1;

    let response: Response;
    try {
      response = await fetch(`${SCRYFALL_BASE_URL}${path}`, {
        ...init,
        headers: init?.headers ?? { Accept: 'application/json' },
      });
    } catch (err) {
      // Scryfall omits `Access-Control-Allow-Origin` on its 429s. A cross-origin
      // response without that header never reaches JS: `fetch` rejects, and the
      // 429 branch below is unreachable in a production build — exactly the case
      // it was written for. (Dev is immune: the Vite `/scryfall-api` proxy makes
      // these same-origin, so the status arrives readable.) So the whole burst
      // would keep firing on the 100ms cadence into an active block, deepening it.
      //
      // A rejection while the device believes it is online is overwhelmingly that
      // throttle, so park the shared queue exactly as a readable 429 would. We
      // can't read Retry-After either, so this uses our own backoff rather than
      // the 60s Scryfall asks for — enough to stop the burst without freezing the
      // app for a minute on what might just be a blip. Genuine offline rejects
      // straight through: no amount of backoff fixes a missing network.
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (!online || opaqueFailures >= MAX_OPAQUE_RETRIES) throw err;

      opaqueFailures += 1;
      stats.blocked += 1;
      const waitMs =
        Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * JITTER_MS;
      logger.warn(
        `[scryfall] opaque failure on ${path} — likely a CORS-blocked 429; cooling down ${Math.round(waitMs)}ms`
      );
      stats.cooldownMs += Math.round(waitMs);
      rateLimiter.cooldown(waitMs);
      continue;
    }

    if (response.status !== 429 && response.status !== 503) return response;
    if (response.status === 429) stats.throttled += 1;
    else stats.unavailable += 1;
    if (attempt >= MAX_RETRIES) {
      stats.gaveUp += 1;
      return response;
    }

    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    // Jitter so a throttled burst doesn't wake in lockstep and strike together.
    const waitMs =
      (parseRetryAfter(response.headers.get('Retry-After')) ?? backoff) + Math.random() * JITTER_MS;
    logger.warn(
      `[scryfall] ${response.status} on ${path} — cooling down ${Math.round(waitMs)}ms (attempt ${attempt + 1})`
    );
    // The next acquire() waits this out, and so does every other caller.
    stats.cooldownMs += Math.round(waitMs);
    rateLimiter.cooldown(waitMs);
  }
}

/**
 * User-facing message for a failed Scryfall call.
 *
 * Three search surfaces render a thrown error's `.message` verbatim
 * (`use-search-cards`, `CardSearchPanel`, `CommanderSearch`), so whatever comes
 * out of here is what a player reads. Raw strings used to leak straight
 * through: a transient upstream blip printed "Scryfall API error: 503 Service
 * Unavailable", and a dropped connection printed the browser's own
 * "NetworkError when attempting to fetch resource." The raw detail still goes
 * to the logger for debugging.
 */
export function scryfallErrorMessage(status: number | null, statusText = ''): string {
  if (status === null) return 'Couldn’t reach Scryfall — check your connection and try again.';
  if (status >= 500) return 'Scryfall is temporarily unavailable — try again in a moment.';
  // Scryfall answers an unparseable query with 400/422.
  if (status === 400 || status === 422)
    return 'Scryfall couldn’t read that search — check the syntax and try again.';
  return `Scryfall couldn’t complete that request (${status}${statusText ? ` ${statusText}` : ''}).`;
}

/** `scryfallRequest` + JSON parsing + the shared user-facing error mapping. */
export async function scryfallFetch<T>(endpoint: string): Promise<T> {
  let response: Response;
  try {
    response = await scryfallRequest(endpoint);
  } catch (e) {
    // fetch() rejects (offline, DNS, dev-proxy down, CORS) with a raw TypeError.
    // Not retried: the usual cause is a genuinely offline device, and four
    // backoffs would hold the spinner ~15s before saying so.
    logger.warn('[scryfall] request failed', endpoint, e);
    throw new Error(scryfallErrorMessage(null));
  }

  if (!response.ok) {
    // /cards/search 404s when NOTHING matched — that's an empty result set, not
    // a failure. Callers used to hand-roll `err.message.includes('404')` (three
    // did; the ones that didn't surfaced "Scryfall API error: 404 Not Found" to
    // the user instead of "no matches"). Normalize it once, here, so every
    // search surface gets an empty list.
    if (response.status === 404 && endpoint.startsWith('/cards/search')) {
      return { object: 'list', total_cards: 0, has_more: false, data: [] } as T;
    }
    logger.warn('[scryfall] HTTP error', response.status, response.statusText, endpoint);
    throw new Error(scryfallErrorMessage(response.status, response.statusText));
  }

  return response.json();
}
