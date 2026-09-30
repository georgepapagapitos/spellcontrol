import { apiUrl } from '@/lib/api/api-base';
import type { DailyResult } from './stats';

/** One friend's day, as GET /api/daily/friends returns it. */
export interface DailyFriend {
  userId: string;
  username: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  result: { solved: boolean; guesses: number } | null;
  streak: number;
}

// Social data is fetched online, not through the local-first sync queue, like
// the game-results leaderboard: it's the server's record, not the device's.

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Record results. The server keeps the FIRST result per day, so this is safe to
 * call with a guest's whole local history on sign-in.
 */
export async function postDailyResults(results: readonly DailyResult[]): Promise<number> {
  const res = await fetch(apiUrl('/api/daily/results'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't save your result. Try again in a moment."));
  const body = (await res.json()) as { saved: number };
  return body.saved;
}

export async function fetchMyDailyResults(): Promise<DailyResult[]> {
  const res = await fetch(apiUrl('/api/daily/me'), { credentials: 'include' });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't load your results. Try again in a moment."));
  const body = (await res.json()) as { results: DailyResult[] };
  return body.results;
}

export async function fetchDailyFriends(date: string): Promise<DailyFriend[]> {
  const res = await fetch(apiUrl(`/api/daily/friends?date=${encodeURIComponent(date)}`), {
    credentials: 'include',
  });
  if (!res.ok)
    throw new Error(
      await readError(res, "Couldn't load your friends' results. Try again in a moment.")
    );
  const body = (await res.json()) as { friends: DailyFriend[] };
  return body.friends;
}
