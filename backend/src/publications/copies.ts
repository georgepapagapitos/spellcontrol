import { getPool } from '../db';

/**
 * A copy made from a public deck page carries `forkedFrom.slug` on the new
 * deck (lib/copy-shared-deck.ts), and that deck syncs up like any other. So
 * `deck_publications.copy_count` is derived, never bumped: the number of
 * OTHER accounts that still hold a live copy.
 *
 * That makes the count hard to pump. It used to be an anonymous POST beacon
 * anyone could fire in a loop. Now each +1 needs its own account, the owner
 * copying their own deck counts for nothing, and a copy that gets deleted
 * stops counting.
 *
 * `slugs` recounts just those decks (a sync push that added copies). With no
 * argument it recounts every deck, which is what a deleted copy needs (the
 * tombstone no longer says which deck it came from). Only rows whose count
 * actually changed are written. Uses user_decks_forked_from_idx.
 */
export async function recountDeckCopies(slugs?: string[]): Promise<void> {
  await getPool().query(
    `UPDATE deck_publications dp
        SET copy_count = counted.n
       FROM (
         SELECT p.slug, count(DISTINCT ud.user_id)::int AS n
           FROM deck_publications p
           LEFT JOIN user_decks ud
             ON (ud.data->'forkedFrom'->>'slug') = p.slug
            AND ud.deleted_at IS NULL
            AND ud.user_id <> p.user_id
          WHERE $1::text[] IS NULL OR p.slug = ANY($1)
          GROUP BY p.slug
       ) counted
      WHERE dp.slug = counted.slug AND dp.copy_count <> counted.n`,
    [slugs ?? null]
  );
}

/** The public deck a synced deck was copied from, if any. */
export function forkedFromSlug(data: unknown): string | null {
  const forkedFrom = (data as { forkedFrom?: { slug?: unknown } } | null)?.forkedFrom;
  return typeof forkedFrom?.slug === 'string' && forkedFrom.slug ? forkedFrom.slug : null;
}
