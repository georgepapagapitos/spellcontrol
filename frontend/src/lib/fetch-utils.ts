import { apiUrl } from './api-base';

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

export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let msg = `Request failed: HTTP ${response.status}`;
    try {
      const body = await response.text();
      try {
        const err = JSON.parse(body);
        if (err.error) msg = err.error;
      } catch {
        if (body.length > 0 && body.length < 200) msg = body;
      }
    } catch {
      /* ignore */
    }
    const e = new Error(msg) as Error & { status?: number };
    e.status = response.status;
    throw e;
  }
  return (await response.json()) as T;
}
