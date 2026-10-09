import { apiUrl } from '@/lib/api/api-base';

/**
 * Mirrors backend/src/brewers/cards.ts's BrewerCard, the one tile every
 * brewer surface serves (directory, rails, following list). Keep in lockstep.
 */
export interface BrewerCard {
  username: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  /** Art crop of the pinned deck, else the most-liked, else the newest. */
  bannerImage: string | null;
  /** Live published decks. */
  deckCount: number;
  followerCount: number;
  /** Color letters (W U B R G, C for colorless), most decks first, max five. */
  topColors: string[];
  topCommander: string | null;
  joinedAt: number;
}

/** Mirrors backend/src/brewers/rails.ts's BrewerRails. A rail under its people
 *  floor arrives as []; render nothing for it. */
export interface BrewerRails {
  newest: BrewerCard[];
  mostLiked: BrewerCard[];
  mostFollowed: BrewerCard[];
  /** Signed in only: brewers with live decks for commanders the viewer has. */
  sharedCommanders: BrewerCard[];
  spotlight: BrewerCard | null;
}

export interface FollowResult {
  following: boolean;
  followerCount: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** The Brewers tab rails (`GET /api/public/brewers/rails`). */
export async function fetchBrewerRails(): Promise<BrewerRails> {
  const res = await fetch(apiUrl('/api/public/brewers/rails'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(
      await readError(res, "Couldn't load brewers. Check your connection and try again.")
    );
  }
  return (await res.json()) as BrewerRails;
}

/** Search brewers by name (`GET /api/public/brewers?q=`). Under two characters
 *  the server answers an empty list, so this skips the request entirely. */
export async function searchBrewers(q: string, limit?: number): Promise<BrewerCard[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const params = new URLSearchParams({ q: text });
  if (limit !== undefined) params.set('limit', String(limit));
  const res = await fetch(apiUrl(`/api/public/brewers?${params.toString()}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't search brewers. Try again."));
  }
  return ((await res.json()) as { brewers: BrewerCard[] }).brewers;
}

/** Follow a brewer. Idempotent. Rejects with the server's message for yourself
 *  or an unknown account. */
export async function followUser(username: string): Promise<FollowResult> {
  const res = await fetch(apiUrl(`/api/follows/${encodeURIComponent(username)}`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await readError(res, "Couldn't follow this brewer. Try again."));
  return (await res.json()) as FollowResult;
}

/** Unfollow a brewer. Idempotent. */
export async function unfollowUser(username: string): Promise<FollowResult> {
  const res = await fetch(apiUrl(`/api/follows/${encodeURIComponent(username)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await readError(res, "Couldn't unfollow this brewer. Try again."));
  return (await res.json()) as FollowResult;
}

/** Everyone the signed-in viewer follows, newest follow first. */
export async function fetchFollowing(): Promise<BrewerCard[]> {
  const res = await fetch(apiUrl('/api/follows/following'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't load who you follow. Try again."));
  }
  return ((await res.json()) as { brewers: BrewerCard[] }).brewers;
}
