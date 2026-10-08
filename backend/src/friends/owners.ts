import { getPool } from '../db';
import { summarizeCardUse } from './card-use';
import { listFriendIds } from './relations';

/** One friend who owns the asked card ("Friends who own this"). */
export interface FriendOwner {
  friendId: string;
  username: string;
  displayName: string | null;
  count: number;
  spare: boolean;
}

/**
 * Which of `callerId`'s friends own `oracleId`. Friends only, and a friend
 * whose collection is Private is skipped, exactly as `/:friendId/collection`
 * hides it. One row per friend: how many copies they own and whether one is
 * spare. No deck ids or names and no prices: `spare` is computed over every
 * deck and cube (private ones included) and leaves as a boolean, the same line
 * `summarizeCardUse` draws. Spare owners first, then by count.
 */
export async function loadFriendOwners(callerId: string, oracleId: string): Promise<FriendOwner[]> {
  const pool = getPool();
  const friendIds = await listFriendIds(callerId);
  if (friendIds.length === 0) return [];

  // ponytail: unindexed jsonb filter over every friend's card rows (bounded by
  // the user_id scan) — add an expression index on (data->>'oracleId') when a
  // friend list's combined collections make this slow.
  const holders = await pool.query<{ user_id: string; id: string; data: unknown }>(
    `SELECT uc.user_id, uc.id, uc.data
       FROM user_cards uc
       JOIN users u ON u.id = uc.user_id
      WHERE uc.user_id = ANY($1::text[])
        AND uc.deleted_at IS NULL
        AND uc.data->>'oracleId' = $2
        AND COALESCE(u.collection_visibility, 'friends') <> 'private'`,
    [friendIds, oracleId]
  );
  if (holders.rows.length === 0) return [];

  const byOwner = new Map<string, { id: string; data: unknown }[]>();
  for (const r of holders.rows) {
    const list = byOwner.get(r.user_id) ?? [];
    list.push({ id: r.id, data: r.data });
    byOwner.set(r.user_id, list);
  }
  const ownerIds = [...byOwner.keys()];
  const [people, deckRows, cubeRows] = await Promise.all([
    pool.query<{ id: string; username: string; display_name: string | null }>(
      `SELECT id, username, display_name FROM users WHERE id = ANY($1::text[])`,
      [ownerIds]
    ),
    pool.query<{ user_id: string; id: string; data: unknown }>(
      `SELECT user_id, id, data FROM user_decks WHERE user_id = ANY($1::text[]) AND deleted_at IS NULL`,
      [ownerIds]
    ),
    pool.query<{ user_id: string; id: string; data: unknown }>(
      `SELECT user_id, id, data FROM user_cubes WHERE user_id = ANY($1::text[]) AND deleted_at IS NULL`,
      [ownerIds]
    ),
  ]);
  const forOwner = (rows: { user_id: string; id: string; data: unknown }[], id: string) =>
    rows.filter((r) => r.user_id === id);

  return people.rows
    .map((p) => {
      const cards = byOwner.get(p.id) ?? [];
      const use = summarizeCardUse(
        cards,
        forOwner(deckRows.rows, p.id),
        forOwner(cubeRows.rows, p.id),
        new Set<string>()
      );
      return {
        friendId: p.id,
        username: p.username,
        displayName: p.display_name,
        count: cards.length,
        spare: use.get(oracleId)?.spare ?? false,
      };
    })
    .sort((a, b) => Number(b.spare) - Number(a.spare) || b.count - a.count);
}
