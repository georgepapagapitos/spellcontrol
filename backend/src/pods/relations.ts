import { getPool } from '../db';

/**
 * A caller's membership status on a pod: 'member', 'invited' (pending), or
 * null (no row — not in the pod, or the pod doesn't exist). The single
 * source other route files import rather than re-querying `pod_members`
 * inline — mirrors `friends/relations.ts:areFriends`'s role.
 */
export async function podMembershipStatus(
  podId: string,
  userId: string
): Promise<'invited' | 'member' | null> {
  const result = await getPool().query<{ status: 'invited' | 'member' }>(
    `SELECT status FROM pod_members WHERE pod_id = $1 AND user_id = $2 LIMIT 1`,
    [podId, userId]
  );
  return result.rows[0]?.status ?? null;
}
