import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { podMembershipStatus } from '../pods/relations';
import { toPublic, type ResultRow } from './game-results';
import { killEdges, rollupForUser } from '../games/rollup';
import type { PublicGameResult } from '../games/result-types';

/**
 * Pod stats: shared game history + per-member leaderboard, read-only over the
 * existing `game_results` table. Kept in its own router (not pods.ts) for
 * concern separation — pods.ts owns entity/membership CRUD, this owns
 * cross-table game_results aggregation, mirroring game-results.ts already
 * being its own router separate from friends.ts.
 */
export const podStatsRouter: Router = Router();

const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 }); // mirrors game-results.ts's readLimiter

/**
 * Pod-context projection over the shared toPublic()/ResultRow — nulls every
 * participant's account identity (userId + username), mirroring
 * PublicGameResultShare's treatment exactly. The pod gate below only requires
 * >=2 pod members present in a game, never "every participant is a pod
 * member", so a qualifying game can include strangers who never joined this
 * pod and have no relationship to the viewer. Nulling every seat (not just
 * non-member ones) needs no per-viewer member-set lookup that could itself be
 * gotten wrong — pod members' identities are already visible via the roster,
 * so nulling theirs too costs nothing.
 */
function toPublicForPod(r: ResultRow): PublicGameResult {
  const pub = toPublic(r);
  return {
    ...pub,
    participants: pub.participants.map((p) => ({ ...p, userId: null, username: null })),
  };
}

/**
 * Games where at least 2 of the given member ids held a seat — the same
 * `participants @>` containment idiom game-results.ts's H2H/leaderboard
 * routes use, counted across the whole member set instead of a single friend
 * pair. Bounded to the 200 most recent, mirroring h2h's own 100-game bound —
 * a heavily-played pod's leaderboard tally understates its true lifetime
 * total past that horizon; acceptable for v1.
 *
 * // ponytail: unindexed JSONB containment scan, add a GIN index if
 * // game_results ever grows large enough for this to matter (matches the
 * // existing H2H/leaderboard routes' identical, already-accepted scaling note).
 */
async function fetchPodGames(memberIds: string[]): Promise<ResultRow[]> {
  const result = await getPool().query<ResultRow>(
    `SELECT session_id, code, format, starting_life, winner_seat, winner_user_id,
            started_at, ended_at, duration_ms, participants, notable_events, summary
       FROM game_results g
      WHERE (
        SELECT COUNT(*) FROM unnest($1::text[]) AS m(uid)
         WHERE g.participants @> jsonb_build_array(jsonb_build_object('userId', m.uid))
      ) >= 2
      ORDER BY ended_at DESC
      LIMIT 200`,
    [memberIds]
  );
  return result.rows;
}

async function activeMemberIds(podId: string): Promise<string[]> {
  const result = await getPool().query<{ user_id: string }>(
    `SELECT user_id FROM pod_members WHERE pod_id = $1 AND status = 'member'`,
    [podId]
  );
  return result.rows.map((r) => r.user_id);
}

// ────────────────────────────────────────────────
// GET /api/pods/:id/games — shared history, pod-scoped and privacy-filtered.
// ────────────────────────────────────────────────
podStatsRouter.get('/:id/games', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const podId = String(req.params.id ?? '');

  // Uniform 403 for a stranger, an invited-not-accepted caller, and an
  // unknown pod id alike — podMembershipStatus returns null for all three,
  // so there's no existence oracle and no distinguishing signal.
  if ((await podMembershipStatus(podId, callerId)) !== 'member') {
    return res.status(403).json({ error: 'Not a pod member.' });
  }

  const memberIds = await activeMemberIds(podId);
  const games = (await fetchPodGames(memberIds)).map(toPublicForPod);
  res.json({ games });
});

// ────────────────────────────────────────────────
// GET /api/pods/:id/leaderboard — per-member W/L over the pod's shared games.
// ────────────────────────────────────────────────
podStatsRouter.get(
  '/:id/leaderboard',
  requireAuth,
  readLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');

    if ((await podMembershipStatus(podId, callerId)) !== 'member') {
      return res.status(403).json({ error: 'Not a pod member.' });
    }

    const roster = await getPool().query<{ user_id: string; username: string }>(
      `SELECT m.user_id, u.username
         FROM pod_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.pod_id = $1 AND m.status = 'member'`,
      [podId]
    );
    const games = await fetchPodGames(roster.rows.map((r) => r.user_id));

    // Tallied in-process exactly like game-results.ts's own summarize() —
    // this response only ever carries the aggregated standings below, never
    // the raw `participants` array (which still holds real usernames at this
    // point, pre-projection) alongside it.
    //
    // The rollups need the camelCase `summary`, so they read the projected
    // shape; the W/L tally below stays on the raw rows it already used.
    const projected = games.map(toPublic);

    const standings = roster.rows.map((m) => {
      let played = 0;
      let wins = 0;
      for (const g of games) {
        const seat = g.participants.find((p) => p.userId === m.user_id);
        if (!seat) continue;
        played++;
        if (g.winner_user_id === m.user_id) wins++;
      }
      const derived = rollupForUser(projected, m.user_id);
      return {
        userId: m.user_id,
        username: m.username,
        played,
        wins,
        winRate: played > 0 ? wins / played : 0,
        // Derived stats cover only games carrying a summary. `ratedGames` is
        // their denominator and is deliberately NOT `played` — pre-summary
        // games are absent data, and folding them in as zeroes would quietly
        // halve everyone's first-blood rate. A member with ratedGames === 0
        // must render as "—", never 0.
        ratedGames: derived.ratedGames,
        avgPlacement: derived.avgPlacement,
        firstBlood: derived.firstBloodDrawn,
        kos: derived.kos,
      };
    });
    standings.sort(
      (a, b) => b.wins - a.wins || b.winRate - a.winRate || a.username.localeCompare(b.username)
    );

    const nameById = new Map(roster.rows.map((r) => [r.user_id, r.username]));
    res.json({ standings, records: podRecords(standings, projected, nameById) });
  }
);

/** Is this pair a rivalry *between pod members*? A qualifying game only needs
 *  2+ members present, so both ends must be checked — otherwise a stranger who
 *  shared one table would have their account id emitted to the whole pod. */
function bothInPod(edge: { killerId: string; victimId: string }, members: Map<string, string>) {
  return members.has(edge.killerId) && members.has(edge.victimId);
}

/**
 * The pod's superlatives — the "who's the table's problem" line. Every field is
 * nullable and a null must render as absent, not as a zero: an unclaimed
 * superlative means the pod has no summary-carrying games yet (or, for
 * `archenemy`, never passes turns, so `summarizeGame` credits no KOs at all).
 */
function podRecords(
  standings: {
    userId: string;
    username: string;
    ratedGames: number;
    firstBlood: number;
    kos: number;
  }[],
  games: PublicGameResult[],
  nameById: Map<string, string>
) {
  const best = <T>(rows: T[], score: (r: T) => number): T | null => {
    const ranked = rows.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a));
    return ranked[0] ?? null;
  };

  const bloodiest = best(standings, (s) => s.firstBlood);
  const deadliest = best(standings, (s) => s.kos);
  // Member-vs-member only — see bothInPod. `standings` is already
  // roster-derived, so the two superlatives above are member-scoped already.
  const rivalry = killEdges(games).find((e) => bothInPod(e, nameById)) ?? null;

  return {
    firstBlood: bloodiest
      ? {
          userId: bloodiest.userId,
          username: bloodiest.username,
          games: bloodiest.firstBlood,
          rate: bloodiest.ratedGames > 0 ? bloodiest.firstBlood / bloodiest.ratedGames : 0,
        }
      : null,
    mostKos: deadliest
      ? { userId: deadliest.userId, username: deadliest.username, kos: deadliest.kos }
      : null,
    archenemy: rivalry
      ? {
          killerId: rivalry.killerId,
          killerName: nameById.get(rivalry.killerId) ?? 'Someone',
          victimId: rivalry.victimId,
          victimName: nameById.get(rivalry.victimId) ?? 'someone',
          kos: rivalry.kos,
        }
      : null,
  };
}
