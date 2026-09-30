import { apiUrl } from '@/lib/api/api-base';
import type { DailyResult } from './stats';

/** How close a guess came on one attribute. `higher`/`lower` point at the ANSWER. */
export type Mark = 'hit' | 'near' | 'miss' | 'higher' | 'lower';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special';

export interface ScoredGuess {
  name: string;
  cells: {
    colors: { value: string; mark: Mark };
    mv: { value: number; mark: Mark };
    type: { value: string; mark: Mark };
    rarity: { value: Rarity; mark: Mark };
    year: { value: number; mark: Mark };
  };
}

export interface DailyClue {
  label: string;
  value: string;
  prose?: true;
}

/**
 * Today's puzzle as the server tells it. The answer never appears while the
 * status is `playing`: the server scores guesses, hands out only the clues a
 * player has earned, and serves the art pre-blurred (E558 hardening).
 */
export interface DailyState {
  date: string;
  number: number;
  maxGuesses: number;
  status: 'playing' | 'solved' | 'failed';
  /** Oldest first. */
  guesses: ScoredGuess[];
  clues: DailyClue[];
  /** Blur step for /api/daily/art while playing; null once finished. */
  artLevel: number | null;
  answer: null | {
    name: string;
    typeLine: string;
    setName: string;
    year: number;
    colors: string;
    art: string;
  };
}

/** One friend's day, as GET /api/daily/friends returns it. */
export interface DailyFriend {
  userId: string;
  username: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  result: { solved: boolean; guesses: number } | null;
  streak: number;
}

// Puzzle and social data is fetched online, not through the local-first sync
// queue, like the game-results leaderboard: it's the server's record.

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read or advance today's puzzle. Signed in, the server holds the guesses and
 * `guesses` is ignored; a guest sends their list each time and nothing is kept.
 */
export async function playDaily(body: {
  guesses?: readonly string[];
  guess?: string;
  giveUp?: boolean;
}): Promise<DailyState> {
  const res = await fetch(apiUrl('/api/daily/play'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't load today's card. Try again in a moment."));
  return (await res.json()) as DailyState;
}

/** The day's art, blurred by the server to `level`. */
export function dailyArtUrl(date: string, level: number): string {
  return apiUrl(`/api/daily/art?date=${encodeURIComponent(date)}&level=${level}`);
}

/**
 * Merge a guest's past results into the account. The server keeps the FIRST
 * result per day and refuses today's (that one is recorded as you play).
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
