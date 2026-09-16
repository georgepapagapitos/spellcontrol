import { apiUrl } from './api-base';

/** Local, as in every sibling client (share/discover/activity/feedback all
 *  keep their own copy rather than sharing one). */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * One deck on a friend's shelf, as `GET /api/friends/:friendId/decks` returns
 * it — the union of their PUBLISHED decks and the ones on the `friends` rung
 * of the visibility ladder.
 *
 * `href` is the only thing that differs between those two sources (`/d/:slug`
 * vs `/s/:token`), which is why the tile takes a href rather than deriving one:
 * a friends-rung deck has no slug and never will.
 */
export interface FriendDeck {
  deckId: string;
  href: string;
  name: string;
  format: string;
  commanderName: string | null;
  commanderImage: string | null;
  colorIdentity: string[];
  cardCount: number;
  bracket: number | null;
  /** Why it is visible — the tile badges `friends` so the viewer knows the
   *  difference between "anyone can see this" and "they showed me this". */
  visibility: 'published' | 'friends';
  updatedAt: number;
}

export interface FriendDecksResponse {
  ownerUsername: string;
  ownerDisplayName: string | null;
  decks: FriendDeck[];
}

export async function fetchFriendDecks(friendId: string): Promise<FriendDecksResponse> {
  const res = await fetch(apiUrl(`/api/friends/${encodeURIComponent(friendId)}/decks`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't load this friend's decks. Try again."));
  }
  return (await res.json()) as FriendDecksResponse;
}
