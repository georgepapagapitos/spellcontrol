import type { Pool } from 'pg';
import { logger } from '../logger';
import { selectNotableEvents, summarizeGame } from './state';
import type { GameState } from './state';
import type { GameResultMode, GameResultParticipant } from './result-types';

/** Everything `game_results` stores, in column order, ready to INSERT. */
export interface GameResultRow {
  sessionId: string;
  code: string;
  mode: GameResultMode;
  recordedByUserId: string | null;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: GameResultParticipant[];
  notableEvents: unknown[];
  summary: unknown;
}

/**
 * Derive the canonical row from a finished `GameState`. Shared by the online
 * write hook (games PATCH) and the local-result POST so the two modes can
 * never disagree on what a participant, a winner, or a summary is.
 *
 * `recordedByUserId` is who posted a local result (null for online — the
 * server wrote it). Usernames are denormalized here so reads need no users
 * join; a seat whose account no longer exists reads `username: null`.
 */
export async function buildGameResultRow(
  state: GameState,
  pool: Pool,
  recordedByUserId: string | null
): Promise<GameResultRow> {
  const userIds = state.players
    .map((p) => p.userId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const usernameById = new Map<string, string>();
  if (userIds.length > 0) {
    const rows = await pool.query<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE id = ANY($1)`,
      [userIds]
    );
    for (const r of rows.rows) usernameById.set(r.id, r.username);
  }

  const participants: GameResultParticipant[] = state.players.map((p) => ({
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

  // Defense-in-depth: an eliminated seat can never be the winner, so never
  // stamp their userId into the permanent winner_user_id. The reducer already
  // coerces such a winnerSeat to null; this guards the permanent-write path
  // directly regardless of how the state was produced.
  const winner =
    state.winnerSeat != null
      ? state.players.find((p) => p.seat === state.winnerSeat && !p.eliminated)
      : undefined;
  const endedAt = state.endedAt ?? state.updatedAt;
  const durationMs = state.startedAt != null ? Math.max(0, endedAt - state.startedAt) : 0;

  return {
    sessionId: state.id,
    code: state.code,
    mode: state.mode,
    recordedByUserId,
    format: state.format,
    startingLife: state.startingLife,
    winnerSeat: state.winnerSeat,
    winnerUserId: winner?.userId ?? null,
    startedAt: state.startedAt,
    endedAt,
    durationMs,
    participants,
    notableEvents: selectNotableEvents(state.events),
    // Derived once here, from the full log — which the table never stores,
    // so the rollups could not recompute it later.
    summary: summarizeGame(state, endedAt),
  };
}

/**
 * Insert a row, idempotently. `ON CONFLICT (session_id) DO NOTHING` absorbs
 * retries and replays; resolves `true` when this call wrote the row and
 * `false` when one already existed (whoever wrote it first wins — a result is
 * immutable once recorded).
 */
export async function insertGameResult(row: GameResultRow, pool: Pool): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, notable_events, summary, created_at,
        mode, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (session_id) DO NOTHING`,
    [
      row.sessionId,
      row.code,
      row.format,
      row.startingLife,
      row.winnerSeat,
      row.winnerUserId,
      row.startedAt,
      row.endedAt,
      row.durationMs,
      JSON.stringify(row.participants),
      JSON.stringify(row.notableEvents),
      JSON.stringify(row.summary),
      row.endedAt,
      row.mode,
      row.recordedByUserId,
    ]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Persist a finished online game as a canonical `game_results` row so every
 * participant reads one shared record. Call only when an online game *flips*
 * to finished (see the guard at the games PATCH write site). Fire-and-forget
 * — a write failure must never break the game's own PATCH response, so
 * errors are logged and swallowed.
 */
export async function persistGameResult(next: GameState, pool: Pool): Promise<void> {
  try {
    const row = await buildGameResultRow(next, pool, null);
    await insertGameResult(row, pool);
  } catch (err) {
    logger.error(`[game-results] failed to persist result for session ${next.id}`, err);
  }
}
