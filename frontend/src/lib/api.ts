import type { UploadResponse } from '../types';

const TIMEOUT_MS = 120_000;

async function handle<T>(response: Response): Promise<T> {
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
    throw new Error(msg);
  }
  return (await response.json()) as T;
}

function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal })
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error(
          'The request timed out. This can happen with very large collections. Try importing a smaller batch.'
        );
      }
      throw new Error('The server is not responding. Give it a moment and try again.');
    })
    .finally(() => clearTimeout(timer));
}

/** Import via file upload (CSV, TSV, or text). */
export async function importFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchWithTimeout('/api/import', { method: 'POST', body: formData });
  return handle<UploadResponse>(response);
}

export interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
}
export type SetMap = Record<string, SetSummary>;

let setMapPromise: Promise<SetMap> | null = null;

/** Fetches the Scryfall set list (cached per page-load). Resolves to a map keyed by uppercase set code. */
export function getSetMap(): Promise<SetMap> {
  if (!setMapPromise) {
    setMapPromise = fetchWithTimeout('/api/sets', { method: 'GET' })
      .then((r) => handle<{ sets: SetMap }>(r))
      .then((j) => j.sets)
      .catch((err) => {
        setMapPromise = null;
        throw err;
      });
  }
  return setMapPromise;
}

/** Import via pasted text — MTGA format, plain card names, or CSV-as-text. */
export async function importText(text: string): Promise<UploadResponse> {
  const response = await fetchWithTimeout('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handle<UploadResponse>(response);
}
