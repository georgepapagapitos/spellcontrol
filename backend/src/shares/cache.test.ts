import { describe, expect, it } from 'vitest';
import { createShareCacheForTests, type ShareContext } from './cache';

function fakeContext(label: string): ShareContext {
  // Cast through unknown — tests don't care about row internals, only identity.
  return {
    share: { token: label } as unknown as ShareContext['share'],
    ownerUsername: `owner-${label}`,
    ownerDisplayName: null,
    data: { userId: label } as unknown as ShareContext['data'],
  };
}

describe('ShareLruCache.get / set', () => {
  it('returns null on miss', () => {
    const cache = createShareCacheForTests();
    expect(cache.get('nope')).toBeNull();
  });

  it('returns the stored value within the TTL', () => {
    const cache = createShareCacheForTests(1000);
    const ctx = fakeContext('a');
    cache.set('tok', ctx, 0);
    expect(cache.get('tok', 500)).toBe(ctx);
  });

  it('expires entries past the TTL and removes them on read', () => {
    const cache = createShareCacheForTests(1000);
    cache.set('tok', fakeContext('a'), 0);
    expect(cache.get('tok', 1001)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('overwrites an existing entry on re-set (resets the TTL window)', () => {
    const cache = createShareCacheForTests(1000);
    cache.set('tok', fakeContext('a'), 0);
    cache.set('tok', fakeContext('b'), 600);
    // Old TTL (1000ms from time 0) would have expired by now; new one
    // (1000ms from 600) is still alive.
    const hit = cache.get('tok', 1500);
    expect(hit?.ownerUsername).toBe('owner-b');
  });
});

describe('ShareLruCache eviction', () => {
  it('evicts the oldest entry when capacity is exceeded', () => {
    const cache = createShareCacheForTests(60_000, 2);
    cache.set('a', fakeContext('a'), 0);
    cache.set('b', fakeContext('b'), 0);
    cache.set('c', fakeContext('c'), 0);
    expect(cache.size()).toBe(2);
    expect(cache.get('a', 0)).toBeNull();
    expect(cache.get('b', 0)?.ownerUsername).toBe('owner-b');
    expect(cache.get('c', 0)?.ownerUsername).toBe('owner-c');
  });

  it('promotes recency on get, so an accessed entry survives the next eviction', () => {
    const cache = createShareCacheForTests(60_000, 2);
    cache.set('a', fakeContext('a'), 0);
    cache.set('b', fakeContext('b'), 0);
    // Touch 'a' so 'b' becomes the LRU.
    expect(cache.get('a', 0)?.ownerUsername).toBe('owner-a');
    cache.set('c', fakeContext('c'), 0);
    expect(cache.get('a', 0)?.ownerUsername).toBe('owner-a');
    expect(cache.get('b', 0)).toBeNull();
    expect(cache.get('c', 0)?.ownerUsername).toBe('owner-c');
  });
});

describe('ShareLruCache.invalidate', () => {
  it('drops the entry immediately', () => {
    const cache = createShareCacheForTests();
    cache.set('tok', fakeContext('a'), 0);
    cache.invalidate('tok');
    expect(cache.get('tok', 0)).toBeNull();
  });

  it('is a no-op for unknown tokens', () => {
    const cache = createShareCacheForTests();
    expect(() => cache.invalidate('nope')).not.toThrow();
    expect(cache.size()).toBe(0);
  });
});
