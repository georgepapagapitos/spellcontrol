import { apiUrl } from './api-base';
import { logger } from '@/lib/util/logger';

/** `fetch` against the backend with cookie auth. Resolves the path via `apiUrl`. */
export function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(url), { credentials: 'same-origin', ...init });
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

/**
 * `fetch` and the read of its body, both under one AbortController timeout.
 * Resolves the path via `apiUrl`, and resolves with whatever `read` returns.
 *
 * The clock runs until `read` settles, not only until the headers arrive.
 * It used to stop at the headers, so a response whose body stalled hung its
 * caller with no timeout left (E1122). `read` is required for that reason: a
 * caller can't take the Response out and read it unbounded.
 *
 * Rejects with `timeoutError` on timeout. Any other failure is rethrown as-is,
 * except that a failure of the request itself (never one thrown by `read`)
 * goes through `onFetchError` when given, for callers that tag it.
 *
 * @param url        API path (passed through `apiUrl`).
 * @param init       `RequestInit` options (merged with the abort signal).
 * @param timeoutMs  How long the request plus `read` may take.
 * @param timeoutError  Error message thrown on timeout.
 * @param read       Reads the response; its result is what this resolves with.
 * @param onFetchError  Maps a transport failure of the request to the error thrown.
 */
export function fetchWithAbortTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutError: string,
  read: (res: Response) => Promise<T>,
  onFetchError?: (err: unknown) => unknown
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutError));
    }, timeoutMs);
  });
  const work = fetch(apiUrl(url), { ...init, signal: controller.signal })
    .catch((err: unknown) => {
      if (isAbort(err)) throw new Error(timeoutError);
      throw onFetchError ? onFetchError(err) : err;
    })
    .then(read)
    .catch((err: unknown) => {
      throw isAbort(err) ? new Error(timeoutError) : err;
    });
  // Once the deadline wins, the aborted request still settles on its own.
  work.catch(() => {});
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
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
