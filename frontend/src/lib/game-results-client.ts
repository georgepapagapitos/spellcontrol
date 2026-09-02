import { apiUrl } from './api-base';
import type { GameEvent } from './game-state';

/** One friend's shared-game W/L, as returned by GET /api/game-results/leaderboard. */
export interface LeaderboardEntry {
  friendId: string;
  friendUsername: string;
  friendDisplayName: string | null;
  gamesPlayed: number;
  callerWins: number;
  friendWins: number;
  lastPlayedAt: number;
}

export interface GameResultParticipant {
  seat: number;
  userId: string | null;
  username: string | null;
  name: string;
  deckId: string | null;
  deckName: string | null;
  commander: string | null;
  colorIdentity: string[];
  finalLife: number;
  eliminated: boolean;
}

export interface PublicGameResult {
  sessionId: string;
  code: string;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: GameResultParticipant[];
  /** Whitelisted eliminate/end/designation events (selectNotableEvents),
   *  null for a pre-migration row. Not yet rendered on the H2H page —
   *  carried here so a future head-to-head notable-moments display has the
   *  right shape without another round-trip. */
  notableEvents: GameEvent[] | null;
}

export interface DeckMatchup {
  callerDeckId: string | null;
  callerDeckName: string | null;
  friendDeckId: string | null;
  friendDeckName: string | null;
  callerWins: number;
  friendWins: number;
  played: number;
}

export interface H2HResponse {
  friend: { id: string; username: string; displayName: string | null };
  results: PublicGameResult[];
  summary: {
    gamesPlayed: number;
    callerWins: number;
    friendWins: number;
    deckMatchups: DeckMatchup[];
    /**
     * Games in this pairing carrying a derived summary — the denominator for
     * the rivalry fields below, and **not** `gamesPlayed`: games recorded
     * before summaries existed contribute nothing. `ratedGames === 0` (or
     * absent, on an older backend) means "no rivalry data", and the block
     * must be hidden rather than rendered as a row of zeroes.
     */
    ratedGames?: number;
    callerAvgPlacement?: number | null;
    friendAvgPlacement?: number | null;
    callerFirstBlood?: number;
    friendFirstBlood?: number;
    /** Times each knocked the *other* out specifically, not total KOs. */
    callerKos?: number;
    friendKos?: number;
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch(apiUrl('/api/game-results/leaderboard'), { credentials: 'include' });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't load the leaderboard. Try again in a moment."));
  const body = (await res.json()) as { leaderboard: LeaderboardEntry[] };
  return body.leaderboard;
}

export async function fetchH2H(friendId: string): Promise<H2HResponse> {
  const res = await fetch(apiUrl(`/api/game-results/h2h/${encodeURIComponent(friendId)}`), {
    credentials: 'include',
  });
  if (!res.ok)
    throw new Error(
      await readError(res, "Couldn't load your head-to-head record. Try again in a moment.")
    );
  return (await res.json()) as H2HResponse;
}
