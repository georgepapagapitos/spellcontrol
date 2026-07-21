import { apiUrl } from './api-base';
import type { DiscoverFilters } from './discover-filters';

/** Sort values `GET /api/discover/decks` itself accepts (`routes/discover.ts`
 *  `SortKey`). `buildable` (percent-owned) is a client-only value computed
 *  over the fetched page and never sent to the server — see discover-buildable.ts. */
export type DiscoverSortKey = 'newest' | 'most-copied' | 'most-viewed';

/**
 * One page of the public Discover browse (`w2-discover-listing-api`'s
 * `GET /api/discover/decks`), now with the full filter/sort surface
 * (`w2-discover-filters-sort`).
 */
export interface DiscoverDeck {
  slug: string;
  name: string;
  ownerUsername: string;
  /** Owner's public-profile display name/avatar — null when unset. */
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
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

/** Filtered/sorted/paginated public deck browse. Unauthenticated — works logged out. */
export async function listDiscoverDecks(
  params: { page?: number; sort?: DiscoverSortKey } & Partial<DiscoverFilters>
): Promise<ListDiscoverDecksResult> {
  const qs = new URLSearchParams({ sort: params.sort ?? 'newest' });
  if (params.page) qs.set('page', String(params.page));
  if (params.commander) qs.set('commander', params.commander);
  if (params.format) qs.set('format', params.format);
  if (params.brackets && params.brackets.length > 0) qs.set('bracket', params.brackets.join(','));
  if (params.colors && params.colors.length > 0) qs.set('colors', params.colors.join(','));
  if (params.budget) qs.set('budget', params.budget);
  const res = await fetch(apiUrl(`/api/discover/decks?${qs.toString()}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load public decks.'));
  }
  return (await res.json()) as ListDiscoverDecksResult;
}

/**
 * Commander-name typeahead backing `CommanderTypeahead` —
 * `w2-discover-listing-api`'s `GET /api/discover/decks/commanders`. Server
 * requires a non-empty `q` (≤40 chars) and returns ≤10 distinct commander
 * names with the given prefix.
 */
export async function searchCommanders(q: string): Promise<string[]> {
  const res = await fetch(apiUrl(`/api/discover/decks/commanders?q=${encodeURIComponent(q)}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to search commanders.'));
  }
  const body = (await res.json()) as { commanders: string[] };
  return body.commanders;
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
