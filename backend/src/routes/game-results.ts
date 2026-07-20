import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { areFriends } from '../friends/relations';
import type { GameResultParticipant, PublicGameResult } from '../games/result-types';

export const gameResultsRouter: Router = Router();

const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/** JSONB containment operand matching any row where `userId` holds a seat. */
function participantFilter(userId: string): string {
  return JSON.stringify([{ userId }]);
}

interface ResultRow {
  session_id: string;
  code: string;
  format: string;
  starting_life: number;
  winner_seat: number | null;
  winner_user_id: string | null;
  started_at: string | null;
  ended_at: string;
  duration_ms: string;
  participants: GameResultParticipant[];
}

function toPublic(r: ResultRow): PublicGameResult {
  return {
    sessionId: r.session_id,
    code: r.code,
    format: r.format,
    startingLife: r.starting_life,
    winnerSeat: r.winner_seat,
    winnerUserId: r.winner_user_id,
    startedAt: r.started_at == null ? null : Number(r.started_at),
    endedAt: Number(r.ended_at),
    durationMs: Number(r.duration_ms),
    participants: r.participants,
  };
}

// ────────────────────────────────────────────────
// GET /api/game-results/leaderboard
// Friends you've played online games with, and your W/L against each. Scoped
// to games where the caller and an accepted friend both participated.
// ────────────────────────────────────────────────
gameResultsRouter.get(
  '/leaderboard',
  requireAuth,
  readLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const result = await getPool().query<{
      friend_id: string;
      friend_username: string;
      friend_display_name: string | null;
      games_played: string;
      caller_wins: string;
      friend_wins: string;
      last_played_at: string;
    }>(
      `WITH friend_ids AS (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships
         WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
       ),
       caller_games AS (
         SELECT session_id, ended_at, winner_user_id, participants
         FROM game_results
         WHERE participants @> $2::jsonb
       ),
       shared AS (
         SELECT g.session_id, g.ended_at, g.winner_user_id, fi.friend_id
         FROM caller_games g
         JOIN friend_ids fi
           ON g.participants @> jsonb_build_array(jsonb_build_object('userId', fi.friend_id))
       )
       SELECT s.friend_id,
              u.username AS friend_username,
              u.display_name AS friend_display_name,
              COUNT(*) AS games_played,
              COUNT(*) FILTER (WHERE s.winner_user_id = $1) AS caller_wins,
              COUNT(*) FILTER (WHERE s.winner_user_id = s.friend_id) AS friend_wins,
              MAX(s.ended_at) AS last_played_at
       FROM shared s
       JOIN users u ON u.id = s.friend_id
       GROUP BY s.friend_id, u.username, u.display_name
       ORDER BY games_played DESC, friend_username ASC`,
      [callerId, participantFilter(callerId)]
    );

    res.json({
      leaderboard: result.rows.map((r) => ({
        friendId: r.friend_id,
        friendUsername: r.friend_username,
        friendDisplayName: r.friend_display_name,
        gamesPlayed: Number(r.games_played),
        callerWins: Number(r.caller_wins),
        friendWins: Number(r.friend_wins),
        lastPlayedAt: Number(r.last_played_at),
      })),
    });
  }
);

// ────────────────────────────────────────────────
// GET /api/game-results/h2h/:friendId
// Head-to-head: every game both the caller and the friend played, plus a
// summary (W/L + per-deck matchup splits). Friend-gated.
// ────────────────────────────────────────────────
gameResultsRouter.get(
  '/h2h/:friendId',
  requireAuth,
  readLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const friendId = String(req.params.friendId ?? '');

    // Uniform 403 for both non-friends and unknown ids (no existence oracle).
    if (!(await areFriends(callerId, friendId))) {
      return res.status(403).json({ error: 'Not friends.' });
    }

    const pool = getPool();
    const friendRow = await pool.query<{ username: string; display_name: string | null }>(
      `SELECT username, display_name FROM users WHERE id = $1`,
      [friendId]
    );
    if (friendRow.rows.length === 0) {
      return res.status(403).json({ error: 'Not friends.' });
    }

    const rows = await pool.query<ResultRow>(
      `SELECT session_id, code, format, starting_life, winner_seat, winner_user_id,
              started_at, ended_at, duration_ms, participants
       FROM game_results
       WHERE participants @> $1::jsonb AND participants @> $2::jsonb
       ORDER BY ended_at DESC
       LIMIT 100`,
      [participantFilter(callerId), participantFilter(friendId)]
    );

    const results = rows.rows.map(toPublic);
    res.json({
      friend: {
        id: friendId,
        username: friendRow.rows[0].username,
        displayName: friendRow.rows[0].display_name,
      },
      results,
      summary: summarize(results, callerId, friendId),
    });
  }
);

interface DeckMatchup {
  callerDeckId: string | null;
  callerDeckName: string | null;
  friendDeckId: string | null;
  friendDeckName: string | null;
  callerWins: number;
  friendWins: number;
  played: number;
}

/**
 * In-process W/L + per-deck-pairing splits over the (≤100) shared games.
 * `gamesPlayed` here is bounded by the query's LIMIT, so for a pair with >100
 * games it understates the true total (and won't match the leaderboard's
 * unbounded count). Acceptable for v1; revisit with pagination if it bites.
 */
function summarize(results: PublicGameResult[], callerId: string, friendId: string) {
  let callerWins = 0;
  let friendWins = 0;
  const byPair = new Map<string, DeckMatchup>();

  for (const g of results) {
    const caller = g.participants.find((p) => p.userId === callerId);
    const friend = g.participants.find((p) => p.userId === friendId);
    if (!caller || !friend) continue; // defensive; the query guarantees both

    const callerWon = g.winnerUserId === callerId;
    const friendWon = g.winnerUserId === friendId;
    if (callerWon) callerWins++;
    if (friendWon) friendWins++;

    const key = `${caller.deckId ?? caller.commander ?? '?'}|${friend.deckId ?? friend.commander ?? '?'}`;
    let m = byPair.get(key);
    if (!m) {
      m = {
        callerDeckId: caller.deckId,
        callerDeckName: caller.deckName ?? caller.commander,
        friendDeckId: friend.deckId,
        friendDeckName: friend.deckName ?? friend.commander,
        callerWins: 0,
        friendWins: 0,
        played: 0,
      };
      byPair.set(key, m);
    }
    m.played++;
    if (callerWon) m.callerWins++;
    if (friendWon) m.friendWins++;
  }

  return {
    gamesPlayed: results.length,
    callerWins,
    friendWins,
    deckMatchups: [...byPair.values()].sort((a, b) => b.played - a.played),
  };
}
