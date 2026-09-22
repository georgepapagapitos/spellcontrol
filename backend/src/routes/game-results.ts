import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { areFriends } from '../friends/relations';
import type {
  GameResultMode,
  GameResultParticipant,
  PublicGameResult,
} from '../games/result-types';
import { rollupForUser, killEdges } from '../games/rollup';
import { buildGameResultRow, insertGameResult } from '../games/persist-result';
import { MAX_LOCAL_RESULT_BYTES, parseLocalResult, parseResultEdit } from '../games/local-result';
import { applyResultEdit } from '../games/edit-result';
import type { GameEvent, GameSummary } from '@spellcontrol/game-core';

export const gameResultsRouter: Router = Router();

const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

/** JSONB containment operand matching any row where `userId` holds a seat. */
function participantFilter(userId: string): string {
  return JSON.stringify([{ userId }]);
}

/**
 * Optional `?mode=local|online` on every read. Absent means both — the whole
 * point of one table is that stats aggregate across modes by default and
 * split only when asked. Anything else is a 400, not a silent "both".
 */
function modeFilter(raw: unknown): { mode: GameResultMode | null } | { error: string } {
  if (raw === undefined || raw === '') return { mode: null };
  if (raw === 'local' || raw === 'online') return { mode: raw };
  return { error: "mode must be 'local' or 'online'." };
}

// Exported for pod-stats.ts's toPublicForPod() — the pod hub's shared-history
// endpoint layers a privacy projection on top of this shape/function rather
// than re-deriving its own (see pod-stats.ts doc comment).
export interface ResultRow {
  session_id: string;
  code: string;
  mode: GameResultMode;
  recorded_by_user_id: string | null;
  host_user_id: string | null;
  format: string;
  starting_life: number;
  winner_seat: number | null;
  winner_user_id: string | null;
  started_at: string | null;
  ended_at: string;
  duration_ms: string;
  participants: GameResultParticipant[];
  notable_events: GameEvent[] | null;
  summary: GameSummary | null;
}

export function toPublic(r: ResultRow): PublicGameResult {
  return {
    sessionId: r.session_id,
    code: r.code,
    mode: r.mode,
    recordedByUserId: r.recorded_by_user_id,
    hostUserId: r.host_user_id,
    format: r.format,
    startingLife: r.starting_life,
    winnerSeat: r.winner_seat,
    winnerUserId: r.winner_user_id,
    startedAt: r.started_at == null ? null : Number(r.started_at),
    endedAt: Number(r.ended_at),
    durationMs: Number(r.duration_ms),
    participants: r.participants,
    notableEvents: r.notable_events,
    summary: r.summary,
  };
}

/** Columns every read route selects. Keeps the SELECT list and `ResultRow` in
 *  step — adding a column in one place and not the other silently yields
 *  `undefined` at runtime with no type error. */
export const RESULT_COLUMNS = `session_id, code, mode, recorded_by_user_id, host_user_id, format, starting_life,
            winner_seat, winner_user_id, started_at, ended_at, duration_ms, participants,
            notable_events, summary`;

/** Accepted-friend ids of `userId`, both directions. */
async function friendIdsOf(userId: string): Promise<Set<string>> {
  const r = await getPool().query<{ friend_id: string }>(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
       FROM friendships
      WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
    [userId]
  );
  return new Set(r.rows.map((x) => x.friend_id));
}

// ────────────────────────────────────────────────
// POST /api/game-results
// Record a finished LOCAL game. The device that tracked the table is the only
// witness, so the caller is trusted for what happened; the server enforces
// shape/size (parseLocalResult) and WHO may be credited: a seat's userId must
// be the caller or an accepted friend, so nobody can pad a stranger's record
// or plant a loss on them. Idempotent on the game id: a retry after a dropped
// response returns the existing row; a different account claiming the same
// id is a 409.
// ────────────────────────────────────────────────
gameResultsRouter.post('/', requireAuth, writeLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  if (JSON.stringify(req.body ?? null).length > MAX_LOCAL_RESULT_BYTES) {
    return res.status(413).json({ error: 'That game is too large to record.' });
  }
  const parsed = parseLocalResult(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const state = parsed.state;

  const credited = state.players.map((p) => p.userId).filter((id): id is string => id !== null);
  if (credited.some((id) => id !== callerId)) {
    const friends = await friendIdsOf(callerId);
    if (credited.some((id) => id !== callerId && !friends.has(id))) {
      return res.status(400).json({ error: 'You can only credit yourself or your friends.' });
    }
  }
  if (new Set(credited).size !== credited.length) {
    return res.status(400).json({ error: 'An account can hold only one seat.' });
  }

  const pool = getPool();
  const row = await buildGameResultRow(state, pool, callerId);
  const inserted = await insertGameResult(row, pool);
  const stored = await pool.query<ResultRow>(
    `SELECT ${RESULT_COLUMNS} FROM game_results WHERE session_id = $1`,
    [state.id]
  );
  const existing = stored.rows[0];
  if (!existing) return res.status(500).json({ error: "Couldn't record the game." });
  if (!inserted && existing.recorded_by_user_id !== callerId) {
    return res.status(409).json({ error: 'That game id is already recorded.' });
  }
  return res.status(inserted ? 201 : 200).json({ result: toPublic(existing) });
});

// ────────────────────────────────────────────────
// GET /api/game-results/mine?mode=&limit=&before=
// The caller's own history, both modes: every game they held a seat in, plus
// every local game they recorded (a recorder needn't have been seated).
// Newest first, keyset-paged on (ended_at, session_id).
// ────────────────────────────────────────────────
gameResultsRouter.get('/mine', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const mf = modeFilter(req.query.mode);
  if ('error' in mf) return res.status(400).json({ error: mf.error });
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;
  // Cursor: "<endedAt>:<sessionId>" of the last row seen.
  let beforeEnded: number | null = null;
  let beforeId: string | null = null;
  if (typeof req.query.before === 'string' && req.query.before.length > 0) {
    const idx = req.query.before.indexOf(':');
    const n = Number(req.query.before.slice(0, idx));
    if (idx <= 0 || !Number.isInteger(n)) return res.status(400).json({ error: 'Bad cursor.' });
    beforeEnded = n;
    beforeId = req.query.before.slice(idx + 1);
  }

  // `hidden=1` flips the list to the rows the caller has hidden. Hiding is
  // never a one-way door: this is how the History tab hands them back.
  const hiddenOnly = req.query.hidden === '1';

  const pool = getPool();
  const rows = await pool.query<ResultRow>(
    `SELECT ${RESULT_COLUMNS}
       FROM game_results r
      WHERE (participants @> $1::jsonb OR recorded_by_user_id = $2)
        AND ($3::text IS NULL OR mode = $3)
        AND ($4::bigint IS NULL OR (ended_at, session_id) < ($4, $5))
        AND (EXISTS (SELECT 1
                       FROM game_result_hidden h
                      WHERE h.session_id = r.session_id AND h.user_id = $2)) = $7::boolean
      ORDER BY ended_at DESC, session_id DESC
      LIMIT $6`,
    [
      participantFilter(callerId),
      callerId,
      mf.mode,
      beforeEnded,
      beforeId ?? '',
      limit + 1,
      hiddenOnly,
    ]
  );
  // Cheap indexed count, returned on every page so the History tab can offer
  // the hidden list without a speculative second request for the 99% of
  // accounts that have hidden nothing.
  const counted = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM game_result_hidden WHERE user_id = $1`,
    [callerId]
  );
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  res.json({
    results: page.map(toPublic),
    nextCursor: rows.rows.length > limit && last ? `${last.ended_at}:${last.session_id}` : null,
    hiddenCount: Number(counted.rows[0]?.n ?? 0),
  });
});

// ────────────────────────────────────────────────
// DELETE /api/game-results/:sessionId
// Two accounts can delete a game outright, and nobody else:
//   - the account that recorded a LOCAL game, and
//   - the account that HOSTED an online one.
//
// The host case is deliberate and is not the same as the others: an online row
// is the table's shared record, so deleting it takes the game out of every
// participant's history and out of the win-loss both of them played into. The
// host is the one who made the table, which makes them the right (and only)
// person to be able to bin a mis-started or test one. Everyone else at that
// table gets `PUT /hidden` instead, which is theirs alone.
//
// The two exclusions below are written as `mode <> x OR col IS DISTINCT FROM`
// rather than `NOT (mode = x AND col = $3)`: host_user_id is NULL on every
// online row recorded before that column existed, and `NULL = $3` is NULL, so
// the NOT form evaluates to NULL and silently filters those rows OUT — taking
// hide away from exactly the games that only ever had it.
//
// `host_user_id` is stamped at persist time (game_sessions is swept at 24h, so
// it cannot be looked up later); online rows written before that column existed
// carry null and stay hide-only for everyone, exactly as they were.
//
// Uniform 404 for "not yours", "not deletable" and "no such row" — no
// existence oracle.
// ────────────────────────────────────────────────
gameResultsRouter.delete(
  '/:sessionId',
  requireAuth,
  writeLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const sessionId = String(req.params.sessionId ?? '');
    const r = await getPool().query(
      `DELETE FROM game_results
        WHERE session_id = $1
          AND (
                (mode = 'local' AND recorded_by_user_id = $2)
             OR (mode = 'online' AND host_user_id = $2)
          )`,
      [sessionId, callerId]
    );
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ error: 'No such game.' });
    res.json({ ok: true });
  }
);

// ────────────────────────────────────────────────
// PATCH /api/game-results/:sessionId
// Correct a LOCAL game the caller recorded: the winner, and each seat's deck.
// Nothing derived from the event log moves (see applyResultEdit) — this fixes
// attribution a human typed, it does not rewrite what the device witnessed.
// Same ownership rule and same uniform 404 as DELETE.
// ────────────────────────────────────────────────
gameResultsRouter.patch(
  '/:sessionId',
  requireAuth,
  writeLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const sessionId = String(req.params.sessionId ?? '');
    const parsed = parseResultEdit(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const edit = parsed.edit;

    const pool = getPool();
    const current = await pool.query<ResultRow>(
      `SELECT ${RESULT_COLUMNS}
         FROM game_results
        WHERE session_id = $1 AND mode = 'local' AND recorded_by_user_id = $2`,
      [sessionId, callerId]
    );
    const row = current.rows[0];
    if (!row) return res.status(404).json({ error: 'No such game.' });

    const seats = new Set(row.participants.map((p) => p.seat));
    if (edit.winnerSeat !== null && !seats.has(edit.winnerSeat)) {
      return res.status(400).json({ error: 'That seat is not in this game.' });
    }
    for (const seat of edit.decks.keys()) {
      if (!seats.has(seat))
        return res.status(400).json({ error: 'That seat is not in this game.' });
    }
    // The persist path refuses to stamp an eliminated seat as the winner; an
    // edit must not become the way around that.
    if (row.participants.some((p) => p.seat === edit.winnerSeat && p.eliminated)) {
      return res.status(400).json({ error: 'A seat that was eliminated cannot be the winner.' });
    }

    const next = applyResultEdit(row.participants, row.summary, edit);
    const updated = await pool.query<ResultRow>(
      `UPDATE game_results
          SET winner_seat = $3, winner_user_id = $4, participants = $5::jsonb, summary = $6::jsonb
        WHERE session_id = $1 AND mode = 'local' AND recorded_by_user_id = $2
        RETURNING ${RESULT_COLUMNS}`,
      [
        sessionId,
        callerId,
        next.winnerSeat,
        next.winnerUserId,
        JSON.stringify(next.participants),
        next.summary === null ? null : JSON.stringify(next.summary),
      ]
    );
    const saved = updated.rows[0];
    if (!saved) return res.status(404).json({ error: 'No such game.' });
    res.json({ result: toPublic(saved) });
  }
);

// ────────────────────────────────────────────────
// PUT / DELETE /api/game-results/:sessionId/hidden
// Drop a row out of the caller's own history list, or put it back.
//
// Exactly the rows they can see but cannot delete: an online game they did not
// host, and a local game a FRIEND recorded them into. Both land in their
// history with no other way off it. A row the caller can delete outright — a
// local one they recorded, or an online one they hosted — is excluded on
// purpose, so there is never two paths to the same thing.
//
// Hiding is list curation and never a retraction: every stats read still
// counts the game, so a seat cannot use this to quietly rewrite a shared
// win-loss. Uniform 404 for "not yours" and "no such row", matching DELETE.
// ────────────────────────────────────────────────
async function callerCanHide(sessionId: string, callerId: string): Promise<boolean> {
  const r = await getPool().query(
    `SELECT 1 FROM game_results
      WHERE session_id = $1
        AND (participants @> $2::jsonb OR recorded_by_user_id = $3)
        AND (mode <> 'local' OR recorded_by_user_id IS DISTINCT FROM $3)
        AND (mode <> 'online' OR host_user_id IS DISTINCT FROM $3)`,
    [sessionId, participantFilter(callerId), callerId]
  );
  return (r.rowCount ?? 0) > 0;
}

gameResultsRouter.put(
  '/:sessionId/hidden',
  requireAuth,
  writeLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const sessionId = String(req.params.sessionId ?? '');
    if (!(await callerCanHide(sessionId, callerId))) {
      return res.status(404).json({ error: 'No such game.' });
    }
    await getPool().query(
      `INSERT INTO game_result_hidden (session_id, user_id, hidden_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, user_id) DO NOTHING`,
      [sessionId, callerId, Date.now()]
    );
    res.json({ ok: true });
  }
);

gameResultsRouter.delete(
  '/:sessionId/hidden',
  requireAuth,
  writeLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const sessionId = String(req.params.sessionId ?? '');
    // No ownership pre-check: a row you hid stays un-hideable by you even if
    // you later lost your seat, and deleting a row you never hid is a no-op.
    await getPool().query(`DELETE FROM game_result_hidden WHERE session_id = $1 AND user_id = $2`, [
      sessionId,
      callerId,
    ]);
    res.json({ ok: true });
  }
);

// ────────────────────────────────────────────────
// GET /api/game-results/leaderboard?mode=
// Friends you've played with, and your W/L against each. Scoped to games
// where the caller and an accepted friend both participated — local or
// online, unless `mode` narrows it.
// ────────────────────────────────────────────────
gameResultsRouter.get(
  '/leaderboard',
  requireAuth,
  readLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const mf = modeFilter(req.query.mode);
    if ('error' in mf) return res.status(400).json({ error: mf.error });
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
           AND ($3::text IS NULL OR mode = $3)
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
      [callerId, participantFilter(callerId), mf.mode]
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
    const mf = modeFilter(req.query.mode);
    if ('error' in mf) return res.status(400).json({ error: mf.error });

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
      `SELECT ${RESULT_COLUMNS}
       FROM game_results
       WHERE participants @> $1::jsonb AND participants @> $2::jsonb
         AND ($3::text IS NULL OR mode = $3)
       ORDER BY ended_at DESC
       LIMIT 100`,
      [participantFilter(callerId), participantFilter(friendId), mf.mode]
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

  // Rivalry stats over the subset of games that carry a summary. `ratedGames`
  // is the honest denominator — it is NOT `gamesPlayed`, because rows written
  // before summaries existed contribute nothing here and must not be counted
  // as games where neither player drew blood.
  const caller = rollupForUser(results, callerId);
  const friend = rollupForUser(results, friendId);
  const edges = killEdges(results);
  const kosBetween = (killerId: string, victimId: string) =>
    edges.find((e) => e.killerId === killerId && e.victimId === victimId)?.kos ?? 0;

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
    /** Games in this set carrying a summary. 0 means "no rivalry data yet" —
     *  the client must render the block as absent, not as a row of zeroes. */
    ratedGames: caller.ratedGames,
    callerAvgPlacement: caller.avgPlacement,
    friendAvgPlacement: friend.avgPlacement,
    callerFirstBlood: caller.firstBloodDrawn,
    friendFirstBlood: friend.firstBloodDrawn,
    /** Times each knocked the *other* out specifically (not total KOs). */
    callerKos: kosBetween(callerId, friendId),
    friendKos: kosBetween(friendId, callerId),
  };
}
