/**
 * In-memory LRU + TTL cache fronting the two anonymous public reads
 * (`GET /api/public/decks/:slug`, `GET /api/public/users/:username`) — the
 * same shape of problem `shares/cache.ts` solves for share tokens (a hot,
 * unauthenticated read in front of a multi-query DB lookup), but written
 * fresh as a small standalone generic rather than bending that tested,
 * token-shaped cache to a second key/value shape.
 *
 * Two singletons below share the same 60s TTL / 500-entry defaults as
 * `shareCache`. Single-process only — see shares/cache.ts's note on Fly's
 * single-instance today; the same tradeoff applies here.
 */

import type { PublicDeck } from '../shares/projections';

export interface PublicDeckPage {
  slug: string;
  publishedAt: number;
  updatedAt: number;
  viewCount: number;
  copyCount: number;
  deck: PublicDeck;
}

export interface PublicDeckSummary {
  slug: string;
  name: string;
  format: string;
  commanderName: string | null;
  commanderImage: string | null;
  colorIdentity: string[];
  cardCount: number;
  bracket: number | null;
  viewCount: number;
  copyCount: number;
  publishedAt: number;
  updatedAt: number;
}

export interface PublicUserProfile {
  username: string;
  memberSince: number;
  deckCount: number;
  decks: PublicDeckSummary[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;

export class LruTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  get(key: string, now: number = Date.now()): T | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    // Re-insert to bump recency — Map iteration order is insertion order, so
    // the oldest key is the front of `entries.keys()` for eviction.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
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

export const deckPublicationCache: LruTtlCache<PublicDeckPage> = new LruTtlCache<PublicDeckPage>();
export const publicUserCache: LruTtlCache<PublicUserProfile> = new LruTtlCache<PublicUserProfile>();

/** Drop a slug from the deck-page cache. Call after unpublish or account
 *  deletion so the next reader sees the 404 immediately rather than waiting
 *  out the TTL. */
export function invalidateDeckPublicationCache(slug: string): void {
  deckPublicationCache.invalidate(slug);
}

/** Drop a username from the profile cache. Same reasoning as above. */
export function invalidatePublicUserCache(username: string): void {
  publicUserCache.invalidate(username);
}
