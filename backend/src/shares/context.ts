import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import {
  shares,
  users,
  userCards,
  userLists,
  userBinders,
  userDecks,
  userCubes,
} from '../db/schema';
import { shareCache, type ShareContext, type ShareDataView } from './cache';
import { getScryfallCache, pickUsdForFinish } from '../scryfall-cache';

/**
 * Stamp current market value onto shared cards from the backend Scryfall cache.
 * Card prices are device-local reference data now (they no longer ride the
 * synced row), so the stored rows carry no price. Cache-ONLY lookup — a share
 * render must never block on the Scryfall network. Cards the cache doesn't know
 * keep whatever price the row had (0 post-strip), so shares are best-effort.
 * Finish-aware: a shared foil shows the foil price, not the non-foil one.
 * Mutates the card objects in place (they're about to be cached in shareCache).
 */
function stampSharePrices(cards: unknown[]): void {
  const ids = new Set<string>();
  for (const c of cards) {
    const id = c && typeof c === 'object' ? (c as { scryfallId?: unknown }).scryfallId : null;
    if (typeof id === 'string' && id) ids.add(id);
  }
  if (ids.size === 0) return;
  const cached = getScryfallCache().getMany([...ids]);
  if (cached.size === 0) return;
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    const card = c as { scryfallId?: string; finish?: string; purchasePrice?: number };
    const sc = card.scryfallId ? cached.get(card.scryfallId) : undefined;
    if (sc) card.purchasePrice = pickUsdForFinish(sc, card.finish);
  }
}

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

  // Per-kind fetch: only the tables this share's projection actually reads
  // (E70 — the old six-table fan-out meant one table's transient failure
  // 500'd every share kind). Binder shares also need every card, because
  // binder materialization (matchers, priority) is only correct over the
  // full collection. `importHistory` had no consumer at all and is now
  // always empty. Unknown kinds fetch nothing — the projectors 404 them.
  const kind = share.kind;
  const wantCards = kind === 'collection' || kind === 'binder';
  const [cards, lists, binders, decks, cubes] = await Promise.all([
    wantCards
      ? db
          .select({ data: userCards.data })
          .from(userCards)
          .where(and(eq(userCards.userId, share.userId), isNull(userCards.deletedAt)))
      : [],
    kind === 'list'
      ? db
          .select({ data: userLists.data })
          .from(userLists)
          .where(and(eq(userLists.userId, share.userId), isNull(userLists.deletedAt)))
      : [],
    kind === 'binder'
      ? db
          .select({ data: userBinders.data })
          .from(userBinders)
          .where(and(eq(userBinders.userId, share.userId), isNull(userBinders.deletedAt)))
      : [],
    kind === 'deck'
      ? db
          .select({ data: userDecks.data })
          .from(userDecks)
          .where(and(eq(userDecks.userId, share.userId), isNull(userDecks.deletedAt)))
      : [],
    kind === 'cube'
      ? db
          .select({ data: userCubes.data })
          .from(userCubes)
          .where(and(eq(userCubes.userId, share.userId), isNull(userCubes.deletedAt)))
      : [],
  ]);

  const data: ShareDataView = {
    collection: {
      cards: cards.map((r) => r.data).filter((d): d is unknown => d != null),
      importHistory: [],
      lists: lists.map((r) => r.data).filter((d): d is unknown => d != null),
    },
    binders: binders.map((r) => r.data).filter((d): d is unknown => d != null),
    decks: decks.map((r) => r.data).filter((d): d is unknown => d != null),
    cubes: cubes.map((r) => r.data).filter((d): d is unknown => d != null),
  };

  stampSharePrices(data.collection.cards);

  const ctx: ShareContext = { share, ownerUsername, data };
  shareCache.set(token, ctx);
  return ctx;
}

/** Drop a token from the cache. Call after revoke so the next reader sees
 *  the 404 immediately rather than waiting out the TTL. */
export function invalidateShareContext(token: string): void {
  shareCache.invalidate(token);
}
