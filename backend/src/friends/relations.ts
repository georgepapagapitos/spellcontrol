import { getPool } from '../db';

/**
 * True if `a` and `b` have an accepted friendship in either direction. The
 * single source for "are these two users friends?" — friend-gated reads
 * (collection pool, friend-scoped shares) and the unfriend route all go
 * through this rather than re-inlining the bidirectional SQL. A user is never
 * their own friend (no self-row exists), so `areFriends(x, x)` is false.
 */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2)
              OR (requester_id = $2 AND addressee_id = $1))
       LIMIT 1`,
    [a, b]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Every accepted friend id of `userId`, either direction. The single source
 * for "who are this user's friends" — before this, the same
 * `CASE WHEN requester_id = $1 …` query was pasted independently in
 * `routes/friends.ts` (GET /), `routes/game-results.ts` (`friendIdsOf`, the
 * friends leaderboard) and `routes/games.ts` (the room browser's friends
 * rows). Callers that want a `Set` (membership checks) wrap this themselves
 * rather than this function returning two shapes.
 */
export async function listFriendIds(userId: string): Promise<string[]> {
  const result = await getPool().query<{ friend_id: string }>(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
       FROM friendships
      WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
    [userId]
  );
  return result.rows.map((r) => r.friend_id);
}
