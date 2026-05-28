/**
 * In-memory LRU + TTL cache for share-token lookups. Sits in front of the
 * multi-query DB read (`shares` → `users` → per-entity user tables) that
 * both `GET /api/shares/public/:token` (JSON projection) and `GET /s/:token`
 * (server-side OG injection) perform.
 *
 * Keyed by token because the token is the inbound identifier on every
 * request — keying by `(userId, kind, resourceId)` would require an extra
 * DB read to translate token → triple, defeating the cache. Re-shares of a
 * revoked resource get a new token and miss the cache; that's rare and
 * acceptable.
 *
 * Only successful lookups are cached. Misses (unknown / revoked tokens, or
 * shares whose underlying resource was deleted) are NOT cached, so a
 * freshly-minted share is reachable on the very next request.
 *
 * Invalidation: explicit on `DELETE /api/shares/:token` (revoke). Owner
 * updates to their per-entity rows rely on the TTL window for eventual
 * consistency —
 * matches the `Cache-Control: private, max-age=60` we already send on the
 * OG response, so a viewer who hard-refreshes won't see staler data than
 * the response told them to expect.
 *
 * Single-process only — Fly runs one instance today (`fly.toml` count=1).
 * If we ever scale horizontally, a revoke on one machine wouldn't
 * propagate to siblings within the TTL; at that point switch to Redis or
 * a sub-30s TTL, but right now this is a 30-line solution to the actual
 * problem.
 */

import type { ShareRow } from '../db/schema';

/**
 * The materialized view of the owner's data that projection functions consume.
 * Shape matches what the legacy `user_data` JSONB exposed, synthesized now from
 * per-entity rows so projections can stay untouched: `cards`/`lists`/`importHistory`
 * are nested under `collection` (the projector indexes into `.cards` /
 * `.lists`), and `binders` / `decks` are top-level arrays.
 */
export interface ShareDataView {
  collection: {
    cards: unknown[];
    importHistory: unknown[];
    lists: unknown[];
  };
  binders: unknown[];
  decks: unknown[];
}

export interface ShareContext {
  share: ShareRow;
  ownerUsername: string;
  data: ShareDataView;
}

interface CacheEntry {
  ctx: ShareContext;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;

class ShareLruCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  get(token: string, now: number = Date.now()): ShareContext | null {
    const hit = this.entries.get(token);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.entries.delete(token);
      return null;
    }
    // Re-insert to bump recency — Map iteration order is insertion order, so
    // the oldest key is the front of `entries.keys()` for eviction.
    this.entries.delete(token);
    this.entries.set(token, hit);
    return hit.ctx;
  }

  set(token: string, ctx: ShareContext, now: number = Date.now()): void {
    if (this.entries.has(token)) this.entries.delete(token);
    this.entries.set(token, { ctx, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  invalidate(token: string): void {
    this.entries.delete(token);
  }

  /** Test-only. Drops every entry. */
  clear(): void {
    this.entries.clear();
  }

  /** Test-only inspector. */
  size(): number {
    return this.entries.size;
  }
}

export const shareCache = new ShareLruCache();

/** Test-only. Exported so suites can spin up an isolated cache with custom
 *  TTL / capacity rather than racing with the singleton. */
export function createShareCacheForTests(ttlMs?: number, maxEntries?: number): ShareLruCache {
  return new ShareLruCache(ttlMs, maxEntries);
}

export type { ShareLruCache };
