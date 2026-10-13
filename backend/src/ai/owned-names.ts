import {
  availableCountsByName,
  collectAllocatedCopyIds,
  type EnrichedCard,
} from '@spellcontrol/binder-routing';
import { getPool } from '../db';

/**
 * The names the AI may search under a restricted scope (T112). `owned` is the
 * collection; `uncommitted` is the names with an available copy, by the shared
 * definition (`availableCountsByName` over the allocation set from
 * `collectAllocatedCopyIds`): a copy that any OTHER deck (mainboard,
 * sideboard, considering, commanders) or a physical cube claims is spoken for,
 * so a card whose every copy is claimed is not offered. This deck's own claims
 * do not count against it. Exported for its route test: the subtraction is the
 * part worth pinning against real rows.
 */
export async function loadOwnedNames(
  userId: string,
  scope: 'owned' | 'uncommitted',
  deckId: string
): Promise<string[]> {
  const pool = getPool();
  const owned = await pool.query<{ id: string; name: string }>(
    `SELECT id, data->>'name' AS name
       FROM user_cards
      WHERE user_id = $1 AND deleted_at IS NULL AND data->>'name' IS NOT NULL`,
    [userId]
  );
  if (scope === 'owned') return [...new Set(owned.rows.map((r) => r.name))];

  const [decks, cubes] = await Promise.all([
    pool.query<{ data: unknown }>(
      `SELECT data FROM user_decks WHERE user_id = $1 AND deleted_at IS NULL AND id <> $2`,
      [userId, deckId]
    ),
    pool.query<{ data: unknown }>(
      `SELECT data FROM user_cubes WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    ),
  ]);
  const claimed = collectAllocatedCopyIds(
    decks.rows.map((r) => r.data),
    cubes.rows.map((r) => r.data)
  );
  const available = availableCountsByName(
    owned.rows.map((r) => ({ copyId: r.id, name: r.name }) as EnrichedCard),
    claimed
  );
  return [...available.keys()];
}
