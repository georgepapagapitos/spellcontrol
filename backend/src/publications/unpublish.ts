import { getPool } from '../db';
import { invalidateDeckPublicationCache } from './cache';

/**
 * Take every live deck publication an account owns down in one UPDATE, and
 * drop each one's cached page. Shared by the two moderation levers that must
 * leave no public deck behind: Hide profile (`POST /reports/:id/resolve`) and
 * Clear profile (publishing requires a display name, so an unnamed account
 * must not keep live publications under a bare handle, E348).
 *
 * Returns the slugs it unpublished. Callers still own the profile-page cache
 * (`invalidatePublicUserCache*`) and any wider purge.
 */
export async function unpublishAllUserDecks(userId: string, now: number): Promise<string[]> {
  const { rows } = await getPool().query<{ slug: string }>(
    `UPDATE deck_publications SET unpublished_at = $2
     WHERE user_id = $1 AND unpublished_at IS NULL
   RETURNING slug`,
    [userId, now]
  );
  for (const { slug } of rows) invalidateDeckPublicationCache(slug);
  return rows.map((r) => r.slug);
}
