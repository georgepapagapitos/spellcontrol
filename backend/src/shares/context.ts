import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { shares, userData, users } from '../db/schema';
import { shareCache, type ShareContext } from './cache';

/**
 * Resolve a share token to its full lookup context — the share row, the
 * owner's username, and the owner's `user_data` row — going through the
 * shared LRU first. Returns null for unknown / revoked tokens and for
 * shares whose owner has no user_data (matches the surface 404 semantics
 * both consumer routes already use).
 *
 * Used by `GET /api/shares/public/:token` (which then projects to the
 * public shape per kind) and `GET /s/:token` (which derives OG tags from
 * the resource's display name + a small count). Both paths share the
 * cache so a viewer who hits the OG-tagged landing page and then the
 * SPA's `/api/shares/public/:token` call pays the DB cost once, not twice.
 */
export async function loadShareContext(token: string): Promise<ShareContext | null> {
  const cached = shareCache.get(token);
  if (cached) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.token, token), isNull(shares.revokedAt)))
    .limit(1);
  const share = rows[0];
  if (!share) return null;

  const dataRows = await db
    .select()
    .from(userData)
    .where(eq(userData.userId, share.userId))
    .limit(1);
  const data = dataRows[0];
  if (!data) return null;

  const userRows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, share.userId))
    .limit(1);
  const ownerUsername = userRows[0]?.username ?? 'unknown';

  const ctx: ShareContext = { share, ownerUsername, data };
  shareCache.set(token, ctx);
  return ctx;
}

/** Drop a token from the cache. Call after revoke so the next reader sees
 *  the 404 immediately rather than waiting out the TTL. */
export function invalidateShareContext(token: string): void {
  shareCache.invalidate(token);
}
