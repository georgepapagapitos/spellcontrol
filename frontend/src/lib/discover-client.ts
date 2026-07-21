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
  likeCount: number;
  publishedAt: number;
  cardOracleIds: string[];
  /** Viewer's own like/bookmark state — always false for a guest. */
  likedByViewer: boolean;
  bookmarkedByViewer: boolean;
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

/** The caller's own bookmarked decks, newest-bookmarked first. No pagination
 *  — personal lists are realistically small (w2-likes-bookmarks). Requires
 *  auth; SavedDecksPage never calls this for a guest. */
export async function listBookmarkedDecks(): Promise<DiscoverDeck[]> {
  const res = await fetch(apiUrl('/api/discover/bookmarks'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load your saved decks.'));
  }
  const body = (await res.json()) as { decks: DiscoverDeck[] };
  return body.decks;
}

export async function likeDeck(slug: string): Promise<{ likeCount: number }> {
  const res = await fetch(apiUrl(`/api/discover/decks/${slug}/like`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't like this deck."));
  }
  return (await res.json()) as { likeCount: number };
}

export async function unlikeDeck(slug: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/discover/decks/${slug}/like`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't unlike this deck."));
  }
}

export async function bookmarkDeck(slug: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/discover/decks/${slug}/bookmark`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't save this deck."));
  }
}

export async function unbookmarkDeck(slug: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/discover/decks/${slug}/bookmark`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't unsave this deck."));
  }
}
