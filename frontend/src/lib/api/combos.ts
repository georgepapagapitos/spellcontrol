import { handleResponse } from '../fetch-utils';
import type { ComboDetail, ComboMatchResponse } from '../../types/combos';

export interface MatchRequest {
  ownedOracleIds: string[];
  deckOracleIds?: string[];
  format?: string;
}

/** Timeout for combo API calls. Long enough to absorb a slow Postgres query
 * with a big collection on a small VPS, short enough that a hung backend
 * doesn't leave the user staring at an infinite spinner. */
const TIMEOUT_MS = 30_000;

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal }).catch((err) => {
      if (err && (err as Error).name === 'AbortError') {
        throw new Error('Combos request timed out — the server is taking too long. Try again.');
      }
      throw new Error('The server is not responding. Try again in a moment.');
    });
    return await handleResponse<T>(response);
  } finally {
    clearTimeout(timer);
  }
}

export async function matchCombos(req: MatchRequest): Promise<ComboMatchResponse> {
  return fetchJson<ComboMatchResponse>('/api/combos/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getCombo(id: string): Promise<ComboDetail> {
  return fetchJson<ComboDetail>(`/api/combos/${encodeURIComponent(id)}`, { method: 'GET' });
}

/**
 * One-shot backfill of oracle ids for old EnrichedCards (saved before
 * EnrichedCard.oracleId existed). Returns a map keyed by scryfallId. Capped
 * server-side at 1000 ids per call — caller handles chunking if needed.
 */
export async function fetchOracleIds(scryfallIds: string[]): Promise<Record<string, string>> {
  if (scryfallIds.length === 0) return {};
  const data = await fetchJson<{ oracleIds: Record<string, string> }>('/api/cards/oracle-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scryfallIds }),
  });
  return data.oracleIds;
}
