import { handleResponse, fetchWithAbortTimeout } from './fetch-utils';
import { logger } from '@/lib/util/logger';
import { ensureCombosCached, matchCombosLocal, searchCombosLocal } from '../offline';
import type { ComboSearchResult } from '../offline';
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
    'Combos are taking too long to load. Try again.'
  ).catch((err: unknown) => {
    if (err instanceof Error && err.message.startsWith('Combos are taking too long')) throw err;
    throw new Error("Couldn't reach combos right now. Try again in a moment.");
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
  let localFailed = false;
  if (await ensureCombosCached()) {
    try {
      const local = await matchCombosLocal({
        ownedOracleIds: req.ownedOracleIds,
        deckOracleIds: req.deckOracleIds,
        format: req.format,
      });
      return { ...local, source: 'local' };
    } catch (err) {
      // A local matcher failure is a browser-storage failure (e.g. Firefox's
      // IndexedDB response cap, a wedged database), and its message is a
      // browser internal — never authored copy. "The dataset couldn't be
      // used" is exactly the case the server fallback below exists for, so
      // take it rather than surfacing the raw exception on the deck panel.
      logger.warn('[combos] local matcher failed, falling back to the server', err);
      localFailed = true;
    }
  }
  // Fallback path — device-local cache couldn't be used. `/api/combos/match`
  // caps candidates at 2000 for memory safety (see MAX_CANDIDATE_COMBOS), so
  // this can under-report a large collection. Tag it so callers don't present
  // it as a complete answer (E212).
  const server = await fetchJson<Omit<ComboMatchResponse, 'source'>>('/api/combos/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  }).catch((err: Error & { status?: number }) => {
    // Signed out AND the device-local matcher just failed: the server's
    // "Sign in to continue." is accurate but names the wrong problem — the
    // user did nothing auth-shaped, their browser storage did. Say that.
    if (localFailed && err.status === 401) {
      throw new Error("Couldn't load combos on this device. Try again in a moment.");
    }
    throw err;
  });
  return { ...server, source: 'server' };
}

/**
 * E216: dataset-wide combo search. Local-only by design — the server's
 * `/match` endpoint can't answer it (it caps its candidate pool at 2000 by
 * popularity before bucketing, which is exactly the truncation this exists to
 * escape). Returns `null` when the local dataset isn't cached, and the caller
 * then falls back to filtering the already-fetched buckets — i.e. the old
 * behaviour, alongside E212's partial-results banner that already explains why
 * the answer is incomplete.
 */
export async function searchCombos(req: {
  query: string;
  ownedOracleIds: string[];
  format?: string;
}): Promise<ComboSearchResult | null> {
  if (!(await ensureCombosCached())) return null;
  return searchCombosLocal(req);
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
