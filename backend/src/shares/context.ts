import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import {
  shares,
  users,
  userCards,
  userImports,
  userLists,
  userBinders,
  userDecks,
} from '../db/schema';
import { shareCache, type ShareContext, type ShareDataView } from './cache';

/**
 * Resolve a share token to its full lookup context — the share row, the
 * owner's username, and a materialized view of the owner's data assembled
 * from the per-entity sync tables. The view mirrors the shape projection
 * functions expect (legacy `user_data` JSONB) so they don't need to know
 * sync moved to per-row storage. Returns null for unknown / revoked tokens.
 *
 * Used by `GET /api/shares/public/:token` (which then projects to the
 * public shape per kind) and `GET /s/:token` (which derives OG tags from
 * the resource's display name + a small count). Both paths share the
 * cache so a viewer who hits the OG-tagged landing page and then the
 * SPA's `/api/shares/public/:token` call pays the DB cost once, not twice.
 *
 * Each per-entity read filters `deletedAt IS NULL`, so tombstoned rows
 * never leak into the public projection.
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

  const userRows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, share.userId))
    .limit(1);
  if (userRows.length === 0) return null;
  const ownerUsername = userRows[0].username;

  // Fan-out: live rows per entity for this owner. Tombstones are filtered out.
  // For deck/binder shares we still read the full set because binder
  // materialization (matchers, priority) needs every binder + every card.
  const [cards, imports, lists, binders, decks] = await Promise.all([
    db
      .select({ data: userCards.data })
      .from(userCards)
      .where(and(eq(userCards.userId, share.userId), isNull(userCards.deletedAt))),
    db
      .select({ data: userImports.data })
      .from(userImports)
      .where(and(eq(userImports.userId, share.userId), isNull(userImports.deletedAt))),
    db
      .select({ data: userLists.data })
      .from(userLists)
      .where(and(eq(userLists.userId, share.userId), isNull(userLists.deletedAt))),
    db
      .select({ data: userBinders.data })
      .from(userBinders)
      .where(and(eq(userBinders.userId, share.userId), isNull(userBinders.deletedAt))),
    db
      .select({ data: userDecks.data })
      .from(userDecks)
      .where(and(eq(userDecks.userId, share.userId), isNull(userDecks.deletedAt))),
  ]);

  const data: ShareDataView = {
    collection: {
      cards: cards.map((r) => r.data).filter((d): d is unknown => d != null),
      importHistory: imports.map((r) => r.data).filter((d): d is unknown => d != null),
      lists: lists.map((r) => r.data).filter((d): d is unknown => d != null),
    },
    binders: binders.map((r) => r.data).filter((d): d is unknown => d != null),
    decks: decks.map((r) => r.data).filter((d): d is unknown => d != null),
  };

  const ctx: ShareContext = { share, ownerUsername, data };
  shareCache.set(token, ctx);
  return ctx;
}

/** Drop a token from the cache. Call after revoke so the next reader sees
 *  the 404 immediately rather than waiting out the TTL. */
export function invalidateShareContext(token: string): void {
  shareCache.invalidate(token);
}
