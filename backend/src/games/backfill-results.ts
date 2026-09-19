import type { Pool } from 'pg';
import { logger } from '../logger';

const MIGRATION = 'game_results_from_user_games_v1';

/**
 * One-shot: fold every user's synced game history (`user_games`, the old
 * per-user `GameRecord` copies) into the canonical `game_results` table.
 *
 * Before this, a local game existed only as N per-user copies and an online
 * game as those copies *plus* one canonical row. Now `game_results` is the
 * one record for both modes, and the client reads its history from it — so
 * without this pass every existing user would open an empty History tab.
 *
 * - Local records become `mode='local'` rows recorded by the owning user.
 * - Online records already have a canonical row (same id = session id), so
 *   `ON CONFLICT DO NOTHING` leaves it alone; the rare pre-E56 online game
 *   with no row is inserted with `recorded_by_user_id` NULL.
 * - Usernames aren't denormalized (the record never carried them) and
 *   `notable_events` stays NULL ("no data captured"), matching every other
 *   pre-migration row's meaning. `summary` is carried when the record has one.
 *
 * Idempotent by construction (the conflict clause), and additionally gated by
 * `app_migrations` so a boot doesn't rescan the table every time. A failure
 * logs and leaves the marker unset, so the next boot retries.
 */
export async function backfillResultsFromUserGames(pool: Pool): Promise<number> {
  const done = await pool.query(`SELECT 1 FROM app_migrations WHERE name = $1`, [MIGRATION]);
  if ((done.rowCount ?? 0) > 0) return 0;
  try {
    const res = await pool.query(
      `INSERT INTO game_results
         (session_id, code, format, starting_life, winner_seat, winner_user_id,
          started_at, ended_at, duration_ms, participants, notable_events, summary, created_at,
          mode, recorded_by_user_id)
       SELECT
         g.id,
         COALESCE(g.data->>'code', ''),
         COALESCE(g.data->>'format', 'casual'),
         COALESCE(NULLIF(g.data->>'startingLife', '')::int, 20),
         NULLIF(g.data->>'winnerSeat', '')::int,
         (SELECT NULLIF(p->>'userId', '')
            FROM jsonb_array_elements(g.data->'players') p
           WHERE NULLIF(p->>'seat', '')::int = NULLIF(g.data->>'winnerSeat', '')::int
             AND NOT COALESCE((p->>'eliminated')::boolean, false)
           LIMIT 1),
         NULLIF(g.data->>'startedAt', '')::bigint,
         (g.data->>'endedAt')::bigint,
         COALESCE(NULLIF(g.data->>'durationMs', '')::bigint, 0),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'seat', COALESCE(NULLIF(p->>'seat', '')::int, 0),
             'userId', NULLIF(p->>'userId', ''),
             'username', NULL,
             'name', COALESCE(p->>'name', 'Player'),
             'deckId', p->'deckId',
             'deckName', p->'deckName',
             'commander', p->'commander',
             'colorIdentity', '[]'::jsonb,
             'finalLife', COALESCE(NULLIF(p->>'finalLife', '')::int, 0),
             'eliminated', COALESCE((p->>'eliminated')::boolean, false)
           ) ORDER BY NULLIF(p->>'seat', '')::int), '[]'::jsonb)
            FROM jsonb_array_elements(g.data->'players') p),
         NULL,
         CASE WHEN jsonb_typeof(g.data->'summary') = 'object' THEN g.data->'summary' ELSE NULL END,
         g.updated_at,
         CASE WHEN g.data->>'mode' = 'online' THEN 'online' ELSE 'local' END,
         CASE WHEN g.data->>'mode' = 'online' THEN NULL ELSE g.user_id END
       FROM user_games g
       WHERE g.deleted_at IS NULL
         AND jsonb_typeof(g.data->'players') = 'array'
         AND (g.data->>'endedAt') ~ '^[0-9]+$'
       ON CONFLICT (session_id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO app_migrations (name, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [MIGRATION, Date.now()]
    );
    const n = res.rowCount ?? 0;
    logger.info(`[game-results] backfilled ${n} result(s) from user_games`);
    return n;
  } catch (err) {
    logger.error('[game-results] backfill from user_games failed; will retry next boot', err);
    return 0;
  }
}
