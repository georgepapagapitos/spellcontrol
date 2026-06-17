import { apiUrl } from './api-base';

/** `fetch` against the backend with cookie auth. Resolves the path via `apiUrl`. */
export function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(url), { credentials: 'same-origin', ...init });
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
