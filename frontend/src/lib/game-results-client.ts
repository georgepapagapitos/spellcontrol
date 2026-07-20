import { apiUrl } from './api-base';

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
  if (!res.ok) throw new Error(await readError(res, 'Failed to load leaderboard.'));
  const body = (await res.json()) as { leaderboard: LeaderboardEntry[] };
  return body.leaderboard;
}

export async function fetchH2H(friendId: string): Promise<H2HResponse> {
  const res = await fetch(apiUrl(`/api/game-results/h2h/${encodeURIComponent(friendId)}`), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to load head-to-head.'));
  return (await res.json()) as H2HResponse;
}
