import { getPool } from '../db';

/** A share's identity for label lookup. */
export interface ShareRef {
  kind: string;
  resourceId: string;
}

/** kind → the per-entity table whose `data->>'name'` is the resource's title. */
const TABLE_FOR_KIND: Record<string, string> = {
  deck: 'user_decks',
  list: 'user_lists',
  binder: 'user_binders',
  cube: 'user_cubes',
};

/**
 * Resolve human display labels for a batch of an owner's shares — the names
 * shown in the friend hub and (later) the directed-share inbox. One query per
 * distinct kind (not per share), so a friend with many shares costs at most
 * four lookups. Returns a map keyed `${kind}:${resourceId}`; a missing entry
 * means the resource was deleted (caller drops those — a dangling share would
 * 404 on open). The single-collection kind has no row, so it's labeled inline.
 */
export async function resolveShareLabels(
  ownerId: string,
  refs: ShareRef[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (refs.length === 0) return labels;

  // Collection has exactly one per user and no id — label it without a query.
  for (const r of refs) {
    if (r.kind === 'collection') labels.set(`collection:${r.resourceId}`, 'Collection');
  }

  // Bucket the id-bearing kinds, then one query per table.
  const idsByKind = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!TABLE_FOR_KIND[r.kind] || !r.resourceId) continue;
    const set = idsByKind.get(r.kind) ?? new Set<string>();
    set.add(r.resourceId);
    idsByKind.set(r.kind, set);
  }

  const pool = getPool();
  for (const [kind, ids] of idsByKind) {
    const table = TABLE_FOR_KIND[kind];
    const rows = await pool.query<{ id: string; name: string | null }>(
      `SELECT id, data->>'name' AS name
         FROM ${table}
        WHERE user_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
      [ownerId, [...ids]]
    );
    for (const row of rows.rows) {
      labels.set(`${kind}:${row.id}`, row.name && row.name.trim() ? row.name : 'Untitled');
    }
  }

  return labels;
}
