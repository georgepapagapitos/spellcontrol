import { handleResponse, fetchWithAbortTimeout } from '../fetch-utils';
import { ensureCombosCached, matchCombosLocal } from '../offline';
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
  const response = await fetchWithAbortTimeout(
    url,
    init,
    TIMEOUT_MS,
    'Combos request timed out — the server is taking too long. Try again.'
  ).catch((err: unknown) => {
    if (err instanceof Error && err.message.startsWith('Combos request timed out')) throw err;
    throw new Error("The server isn't responding. Try again in a moment.");
  });
  return handleResponse<T>(response);
}

export async function matchCombos(req: MatchRequest): Promise<ComboMatchResponse> {
  // Prefer client-side matching against the device-local combo dataset: no
  // login required, no per-request load on the server (whose /match endpoint
  // has OOM-crashed under load), and it works offline. The dataset is global
  // reference data, lazily cached on first use. We only fall back to the authed
  // server endpoint when the dataset can't be cached (e.g. offline + empty
  // cache on first run) — for a logged-in user that still works.
  if (await ensureCombosCached()) {
    return matchCombosLocal({
      ownedOracleIds: req.ownedOracleIds,
      deckOracleIds: req.deckOracleIds,
      format: req.format,
    });
  }
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
