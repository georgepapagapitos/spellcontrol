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

/** Tests only: forget that the backend was unreachable (and the request
 *  spacing, which a fake-timer test leaves ahead of the real clock). */
export function resetEdhrecProxyState(): void {
  proxyDownUntil = 0;
  rateLimiter.reset();
}

/**
 * One GET for an EDHREC path. Goes to our backend; falls back to EDHREC
 * directly ONLY when the backend is unreachable (the request throws, or its
 * edge answers 502/504). Any answer the route produced, including 403/404
 * ("no such page") and 503 (EDHREC down, nothing stored), is returned as is:
 * asking EDHREC again from the browser would only double the traffic. The one
 * deliberate cost of the fallback is that the browser then talks to EDHREC
 * itself, which is why the CSP keeps json.edhrec.com in connect-src.
 */
export async function edhrecRequest(endpoint: string): Promise<Response> {
  const headers = { Accept: 'application/json' };
  if (Date.now() >= proxyDownUntil) {
    try {
      const res = await fetch(apiUrl(`${PROXY_PATH}${endpoint}`), { headers });
      const edge = (res.status === 502 || res.status === 504) && !res.headers.get(PROXY_HEADER);
      if (!edge) return res;
      await res.body?.cancel();
    } catch {
      // Unreachable (offline, DNS, no server): fall through to EDHREC.
    }
    proxyDownUntil = Date.now() + PROXY_DOWN_MS;
  }
  return fetch(`${DIRECT_BASE_URL}${endpoint}`, { headers });
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
