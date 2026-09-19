import { getPool } from '../db';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from './cache';
import { invalidateShareContext } from '../shares/context';

/**
 * Drop every public-read cache entry that renders this user's identity or
 * content: the profile page, every deck page they ever published (its byline
 * carries the display name), and every share they minted. The three caches
 * hold entries for up to 60 s and only know about the rows they read, so any
 * write that changes who this user is on the public side — a profile edit,
 * a moderation clear, an account deletion by either the user or an admin —
 * goes through here. Call it BEFORE deleting the user row: the slugs and
 * tokens cascade away with it. (Playtest batch 12: an admin-deleted account's
 * deck page served for 58 s; a cleared display name for 60 s.)
 */
export async function purgeUserPublicCaches(userId: string, username: string): Promise<void> {
  const pool = getPool();
  const [pubs, tokens] = await Promise.all([
    pool.query<{ slug: string }>(`SELECT slug FROM deck_publications WHERE user_id = $1`, [userId]),
    pool.query<{ token: string }>(`SELECT token FROM shares WHERE user_id = $1`, [userId]),
  ]);
  for (const { slug } of pubs.rows) invalidateDeckPublicationCache(slug);
  for (const { token } of tokens.rows) invalidateShareContext(token);
  invalidatePublicUserCache(username);
}
