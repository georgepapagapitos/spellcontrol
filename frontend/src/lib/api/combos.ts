import { handleResponse } from '../fetch-utils';
import type { ComboDetail, ComboMatchResponse } from '../../types/combos';

export interface MatchRequest {
  ownedOracleIds: string[];
  deckOracleIds?: string[];
  format?: string;
}

export async function matchCombos(req: MatchRequest): Promise<ComboMatchResponse> {
  const response = await fetch('/api/combos/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return handleResponse<ComboMatchResponse>(response);
}

export async function getCombo(id: string): Promise<ComboDetail> {
  const response = await fetch(`/api/combos/${encodeURIComponent(id)}`, { method: 'GET' });
  return handleResponse<ComboDetail>(response);
}

/**
 * One-shot backfill of oracle ids for old EnrichedCards (saved before
 * EnrichedCard.oracleId existed). Returns a map keyed by scryfallId. Capped
 * server-side at 1000 ids per call — caller handles chunking if needed.
 */
export async function fetchOracleIds(scryfallIds: string[]): Promise<Record<string, string>> {
  if (scryfallIds.length === 0) return {};
  const response = await fetch('/api/cards/oracle-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scryfallIds }),
  });
  const data = await handleResponse<{ oracleIds: Record<string, string> }>(response);
  return data.oracleIds;
}
