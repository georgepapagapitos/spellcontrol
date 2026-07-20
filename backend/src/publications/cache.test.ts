import { describe, expect, it } from 'vitest';
import { LruTtlCache, type PublicDeckPage, type PublicUserProfile } from './cache';

function fakeDeckPage(slug: string): PublicDeckPage {
  // Cast through unknown — these tests only care about identity/slug, not
  // the full PublicDeck shape.
  return {
    slug,
    publishedAt: 0,
    updatedAt: 0,
    viewCount: 0,
    copyCount: 0,
    deck: { ownerUsername: `owner-${slug}` } as unknown as PublicDeckPage['deck'],
  };
}

describe('LruTtlCache.get / set', () => {
  it('returns null on miss', () => {
    const cache = new LruTtlCache<PublicDeckPage>();
    expect(cache.get('nope')).toBeNull();
  });

  it('returns the stored value within the TTL', () => {
    const cache = new LruTtlCache<PublicDeckPage>(1000);
    const page = fakeDeckPage('a');
    cache.set('slug-a', page, 0);
    expect(cache.get('slug-a', 500)).toBe(page);
  });

  it('expires entries past the TTL and removes them on read', () => {
    const cache = new LruTtlCache<PublicDeckPage>(1000);
    cache.set('slug-a', fakeDeckPage('a'), 0);
    expect(cache.get('slug-a', 1001)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('overwrites an existing entry on re-set (resets the TTL window)', () => {
    const cache = new LruTtlCache<PublicDeckPage>(1000);
    cache.set('slug-a', fakeDeckPage('a'), 0);
    cache.set('slug-a', fakeDeckPage('b'), 600);
    // Old TTL (1000ms from time 0) would have expired by now; new one
    // (1000ms from 600) is still alive.
    const hit = cache.get('slug-a', 1500);
    expect(hit?.slug).toBe('b');
  });
});

describe('LruTtlCache eviction', () => {
  it('evicts the oldest entry when capacity is exceeded', () => {
    const cache = new LruTtlCache<PublicDeckPage>(60_000, 2);
    cache.set('a', fakeDeckPage('a'), 0);
    cache.set('b', fakeDeckPage('b'), 0);
    cache.set('c', fakeDeckPage('c'), 0);
    expect(cache.size()).toBe(2);
    expect(cache.get('a', 0)).toBeNull();
    expect(cache.get('b', 0)?.slug).toBe('b');
    expect(cache.get('c', 0)?.slug).toBe('c');
  });

  it('promotes recency on get, so an accessed entry survives the next eviction', () => {
    const cache = new LruTtlCache<PublicDeckPage>(60_000, 2);
    cache.set('a', fakeDeckPage('a'), 0);
    cache.set('b', fakeDeckPage('b'), 0);
    // Touch 'a' so 'b' becomes the LRU.
    expect(cache.get('a', 0)?.slug).toBe('a');
    cache.set('c', fakeDeckPage('c'), 0);
    expect(cache.get('a', 0)?.slug).toBe('a');
    expect(cache.get('b', 0)).toBeNull();
    expect(cache.get('c', 0)?.slug).toBe('c');
  });
});

describe('LruTtlCache.invalidate', () => {
  it('drops the entry immediately', () => {
    const cache = new LruTtlCache<PublicDeckPage>();
    cache.set('slug-a', fakeDeckPage('a'), 0);
    cache.invalidate('slug-a');
    expect(cache.get('slug-a', 0)).toBeNull();
  });

  it('is a no-op for unknown keys', () => {
    const cache = new LruTtlCache<PublicDeckPage>();
    expect(() => cache.invalidate('nope')).not.toThrow();
    expect(cache.size()).toBe(0);
  });
});

describe('LruTtlCache<PublicUserProfile>', () => {
  it('type-checks and behaves identically against a second, unrelated shape', () => {
    const cache = new LruTtlCache<PublicUserProfile>();
    const profile: PublicUserProfile = {
      username: 'alice',
      memberSince: 0,
      deckCount: 0,
      decks: [],
    };
    cache.set('alice', profile, 0);
    expect(cache.get('alice', 0)).toBe(profile);
    cache.invalidate('alice');
    expect(cache.get('alice', 0)).toBeNull();
  });
});
