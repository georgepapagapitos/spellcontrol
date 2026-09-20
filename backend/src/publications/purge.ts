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
export async function purgeUserPublicCaches(userId: string): Promise<void> {
  const pool = getPool();
  const [pubs, tokens] = await Promise.all([
    pool.query<{ slug: string }>(`SELECT slug FROM deck_publications WHERE user_id = $1`, [userId]),
    pool.query<{ token: string }>(`SELECT token FROM shares WHERE user_id = $1`, [userId]),
  ]);
  for (const { slug } of pubs.rows) invalidateDeckPublicationCache(slug);
  for (const { token } of tokens.rows) invalidateShareContext(token);
  await invalidatePublicUserCacheById(userId);
}

/**
 * Drop this user's profile-page entry, resolving their CURRENT handle from
 * their id.
 *
 * Take the id, never a username: `req.user.username` is a JWT claim, not a
 * live read, so once usernames became changeable a caller passing it would
 * invalidate a handle the user no longer has and leave the real entry serving
 * stale data for the rest of its TTL. The profile cache is keyed by username
 * because that is how it is read (`GET /api/public/users/:username`), so the
 * resolve has to happen somewhere — here, once, rather than at each call site.
 */
export async function invalidatePublicUserCacheById(userId: string): Promise<void> {
  const { rows } = await getPool().query<{ username: string }>(
    `SELECT username FROM users WHERE id = $1`,
    [userId]
  );
  const username = rows[0]?.username;
  if (username) invalidatePublicUserCache(username);
}
