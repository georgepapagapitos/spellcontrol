import { apiUrl } from '@/lib/api/api-base';

// How the browser reaches EDHREC: through our backend, with a direct fallback.
// Split out of client.ts, which is at its file-size ceiling.

/** EDHREC itself: the Vite proxy in dev, the real host in a build. Only the
 *  fallback now; see edhrecRequest. */
const DIRECT_BASE_URL = import.meta.env.DEV ? '/edhrec-api' : 'https://json.edhrec.com';

/** Every EDHREC page is read through our backend (`GET /api/edhrec/page/*`),
 *  which keeps a last-known-good copy, so a CORS change, a rate limit or a
 *  broken page on EDHREC's side degrades to yesterday's page instead of
 *  breaking generation. The JSON is byte-identical to EDHREC's. */
const PROXY_PATH = '/api/edhrec/page';

/** Set on every answer the route itself produces. A 502/504 without it came
 *  from the host's edge, meaning our backend is down, not EDHREC. */
const PROXY_HEADER = 'X-Edhrec-Cache';

/** After the backend fails to answer, go straight to EDHREC for this long
 *  rather than paying a failed attempt on every page. */
const PROXY_DOWN_MS = 60_000;
let proxyDownUntil = 0;

/**
 * After one page runs out of 429/503 retries, EDHREC (or our route) is down or
 * throttling us, so other pages skip the backoff ladder for this long instead
 * of each spending about 15 s on it before generation can fall back (E1060).
 * Every page still gets one attempt, and a success closes the window, so a
 * recovery is seen on the next request.
 */
const OUTAGE_MS = 60_000;
let outageUntil = 0;

/** One attempt's budget. A connection that stalls (no reset, no status) would
 *  otherwise hang generation forever, since the 429/503 retry only sees answers. */
export const ATTEMPT_TIMEOUT_MS = 15_000;

/** True for the abort a per-attempt timeout produces. */
export function isEdhrecTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'TimeoutError';
}

function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { headers, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
}

export function edhrecRetriesAllowed(): boolean {
  return Date.now() >= outageUntil;
}

export function noteEdhrecOutage(down: boolean): void {
  outageUntil = down ? Date.now() + OUTAGE_MS : 0;
}

/** Tests only: forget that the backend was unreachable, the outage window,
 *  and the request spacing, which a fake-timer test leaves ahead of the real
 *  clock. */
export function resetEdhrecProxyState(): void {
  proxyDownUntil = 0;
  outageUntil = 0;
  rateLimiter.reset();
}

/**
 * One GET for an EDHREC path. Goes to our backend; falls back to EDHREC
 * directly ONLY when the backend is unreachable (the request throws, or its
 * edge answers 502/504), or when it says it cannot reach EDHREC and holds no
 * copy (503 'unavailable'): that request goes direct once and the rest of the
 * session's pages do too for a minute, rather than each paying the server's
 * retry. Any other answer the route produced, including 403/404 ("no such
 * page"), is returned as is: asking EDHREC again would only double traffic. The one
 * deliberate cost of the fallback is that the browser then talks to EDHREC
 * itself, which is why the CSP keeps json.edhrec.com in connect-src.
 */
export async function edhrecRequest(endpoint: string): Promise<Response> {
  const headers = { Accept: 'application/json' };
  if (Date.now() >= proxyDownUntil) {
    try {
      const res = await timedFetch(apiUrl(`${PROXY_PATH}${endpoint}`), headers);
      const tag = res.headers.get(PROXY_HEADER);
      // 502/504 with no route header: the host's edge, our backend is down.
      // 503 'unavailable': the backend is up but cannot reach EDHREC and holds
      // no copy, so the browser may do better from its own network.
      const down = (res.status === 502 || res.status === 504) && !tag;
      const cannotReach = res.status === 503 && tag === 'unavailable';
      if (!down && !cannotReach) return res;
      await res.body?.cancel();
    } catch {
      // Unreachable or stalled past the timeout (offline, DNS, no server):
      // fall through to EDHREC.
    }
    proxyDownUntil = Date.now() + PROXY_DOWN_MS;
  }
  return timedFetch(`${DIRECT_BASE_URL}${endpoint}`, headers);
}

const MIN_REQUEST_DELAY = 100; // 100ms between requests

class RateLimiter {
  private lastRequestTime = 0;

  reset(): void {
    this.lastRequestTime = 0;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest));
    }

    this.lastRequestTime = Date.now();
  }
}

export const rateLimiter = new RateLimiter();
