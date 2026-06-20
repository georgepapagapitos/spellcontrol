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
