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
  // The server matcher is the default (E560): the full dataset is 19 MB
  // gzipped and 80 to 95 MB on disk, so the browser holds it only for a visitor
  // who opted into offline card data in Settings. `ensureCombosCached` is false
  // for everyone else and never downloads. `/api/combos/match` is public, so a
  // signed-out visitor gets the same answer.
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
      // browser internal, never authored copy. "The dataset couldn't be
      // used" is exactly the case the server path below is for, so take it
      // rather than surfacing the raw exception on the deck panel.
      logger.warn('[combos] local matcher failed, falling back to the server', err);
    }
  }
  // `/api/combos/match` caps candidates at 2000 for memory safety (see
  // MAX_CANDIDATE_COMBOS). It says when the cap dropped any (`truncated`), so
  // callers only present the answer as partial when it is (E212).
  const server = await fetchJson<Omit<ComboMatchResponse, 'source'>>('/api/combos/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return { ...server, source: 'server' };
}

/**
 * E216: dataset-wide combo search. Local-only by design — the server's
 * `/match` endpoint can't answer it (it caps its candidate pool at 2000 by
 * popularity before bucketing, which is exactly the truncation this exists to
 * escape). Returns `null` when the local dataset isn't cached, and the caller
 * then falls back to filtering the already-fetched buckets — i.e. the old
 * behavior, alongside E212's partial-results banner that already explains why
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

/**
 * Spellbook's bracket tag for a few combo ids, from the server: how deck
 * generation tags EDHREC's combos on a device that has not downloaded the
 * dataset (E560). Ids the dataset doesn't know are absent from the map.
 */
export async function fetchComboBracketTags(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const data = await fetchJson<{ tags: Record<string, string | null> }>(
    '/api/combos/bracket-tags',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }
  );
  return new Map(Object.entries(data.tags));
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
