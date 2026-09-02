import { apiUrl } from './api-base';
import { logger } from './logger';

/** `fetch` against the backend with cookie auth. Resolves the path via `apiUrl`. */
export function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(url), { credentials: 'same-origin', ...init });
}

/**
 * `fetch` with an AbortController-based timeout. Resolves the path via `apiUrl`.
 * Rejects with the given `timeoutError` message on timeout; re-throws any other
 * fetch error as-is so callers can inspect `err.name === 'AbortError'` or wrap
 * differently.
 *
 * @param url        API path (passed through `apiUrl`).
 * @param init       `RequestInit` options (merged with the abort signal).
 * @param timeoutMs  How long to wait before aborting.
 * @param timeoutError  Error message thrown on timeout.
 */
export function fetchWithAbortTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutError: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(apiUrl(url), { ...init, signal: controller.signal })
    .then(
      (r) => r,
      (err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(timeoutError);
        }
        throw err;
      }
    )
    .finally(() => clearTimeout(timer));
}

/**
 * Copy for a non-OK response that carried no `{ error }` of its own — a proxy
 * or gateway page, a rate limit, a body we couldn't read. Says what happened
 * and what to do; the status itself is kept on the thrown error (`status`) for
 * callers that branch on it, and logged, but never shown as "HTTP 502".
 */
export function describeHttpFailure(status: number): string {
  if (status === 401) return 'Sign in to continue.';
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "That wasn't found. It may have been removed.";
  if (status === 408 || status === 504) return 'That took too long. Try again in a moment.';
  if (status === 413) return "That's too large to send. Try a smaller batch.";
  if (status === 429) return "You're doing that a little too fast. Wait a moment and try again.";
  if (status >= 500) return "The server isn't responding right now. Try again in a moment.";
  return 'Something went wrong. Try again.';
}

export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let msg = describeHttpFailure(response.status);
    try {
      const body = await response.text();
      try {
        const err = JSON.parse(body);
        if (typeof err?.error === 'string' && err.error) msg = err.error;
      } catch {
        // A short plain-text body from our own server is authored copy; an
        // HTML error page from a proxy is not, and neither is a bare status.
        const text = body.trim();
        if (text.length > 0 && text.length < 200 && !/[<>{}]/.test(text)) msg = text;
      }
    } catch {
      /* ignore */
    }
    logger.warn(`[api] ${response.status} ${response.url || ''}`.trim(), msg);
    const e = new Error(msg) as Error & { status?: number };
    e.status = response.status;
    throw e;
  }
  return (await response.json()) as T;
}
