import type { Pool } from 'pg';
import { logger } from '../logger';
import type { GameState } from './state';
import type { GameResultParticipant } from './result-types';

/**
 * Persist a finished online game as a canonical `game_results` row so every
 * participant reads one shared record (vs the N divergent per-user
 * `user_games` copies). Idempotent: `ON CONFLICT (session_id) DO NOTHING`
 * absorbs retries/replays. Call only when an online game *flips* to finished
 * (see the guard at the games PATCH write site). Fire-and-forget — a write
 * failure must never break the game's own PATCH response, so errors are logged
 * and swallowed.
 */
export async function persistGameResult(next: GameState, pool: Pool): Promise<void> {
  try {
    const userIds = next.players
      .map((p) => p.userId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    // Denormalize usernames so reads need no users join.
    const usernameById = new Map<string, string>();
    if (userIds.length > 0) {
      const rows = await pool.query<{ id: string; username: string }>(
        `SELECT id, username FROM users WHERE id = ANY($1)`,
        [userIds]
      );
      for (const r of rows.rows) usernameById.set(r.id, r.username);
    }

    const participants: GameResultParticipant[] = next.players.map((p) => ({
      seat: p.seat,
      userId: p.userId,
      username: p.userId ? (usernameById.get(p.userId) ?? null) : null,
      name: p.name,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      colorIdentity: p.colorIdentity ?? [],
      finalLife: p.life,
      eliminated: p.eliminated,
    }));

    const winner =
      next.winnerSeat != null ? next.players.find((p) => p.seat === next.winnerSeat) : undefined;
    const endedAt = next.endedAt ?? next.updatedAt;
    const durationMs = next.startedAt != null ? Math.max(0, endedAt - next.startedAt) : 0;

    await pool.query(
      `INSERT INTO game_results
         (session_id, code, format, starting_life, winner_seat, winner_user_id,
          started_at, ended_at, duration_ms, participants, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        next.id,
        next.code,
        next.format,
        next.startingLife,
        next.winnerSeat,
        winner?.userId ?? null,
        next.startedAt,
        endedAt,
        durationMs,
        JSON.stringify(participants),
        endedAt,
      ]
    );
  } catch (err) {
    logger.error(`[game-results] failed to persist result for session ${next.id}`, err);
  }
}
