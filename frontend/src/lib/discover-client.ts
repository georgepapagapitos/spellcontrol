import { apiUrl } from './api-base';

/**
 * One page of the public Discover browse (`w2-discover-listing-api`'s
 * `GET /api/discover/decks`). This PR only drives `sort=newest` with no
 * filters — `w2-discover-filters-sort` wires the rest of the endpoint's
 * already-shipped query params.
 */
export interface DiscoverDeck {
  slug: string;
  name: string;
  ownerUsername: string;
  format: string;
  commanderName: string | null;
  colorIdentity: string[];
  bracket: number | null;
  estimatedValueUsd: number | null;
  viewCount: number;
  copyCount: number;
  publishedAt: number;
  cardOracleIds: string[];
}

export interface ListDiscoverDecksResult {
  decks: DiscoverDeck[];
  page: number;
  hasMore: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Newest-first public deck browse. Unauthenticated — works logged out. */
export async function listDiscoverDecks(params: {
  page?: number;
}): Promise<ListDiscoverDecksResult> {
  const qs = new URLSearchParams({ sort: 'newest' });
  if (params.page) qs.set('page', String(params.page));
  const res = await fetch(apiUrl(`/api/discover/decks?${qs.toString()}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load public decks.'));
  }
  return (await res.json()) as ListDiscoverDecksResult;
}
