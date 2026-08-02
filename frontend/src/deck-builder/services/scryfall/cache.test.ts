// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { readCachedCards, persistCard, flushPersistedCards, _resetCacheForTests } from './cache';

function makeCard(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'cmm',
    set_name: 'Commander Masters',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

beforeEach(async () => {
  _resetCacheForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('spellcontrol-scryfall-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scryfall persistent card cache', () => {
  it('round-trips a card across a simulated reload', async () => {
    persistCard('Sol Ring', makeCard('Sol Ring'));
    await flushPersistedCards();

    // A fresh process would re-open the DB from scratch.
    _resetCacheForTests();

    const found = await readCachedCards(['Sol Ring']);
    expect(found.get('Sol Ring')?.name).toBe('Sol Ring');
  });

  // Collection/cube resolves ask about every unique name a player owns, which
  // is more keys than one transaction should carry.
  it('reads a key set larger than one chunk', async () => {
    const keys = Array.from({ length: 1200 }, (_, i) => `Card ${i}`);
    for (const key of keys) persistCard(key, makeCard(key));
    await flushPersistedCards();

    const found = await readCachedCards([...keys, 'Never Cached']);
    expect(found.size).toBe(1200);
  });

  it('returns only the keys it has, leaving the rest for the network', async () => {
    persistCard('Sol Ring', makeCard('Sol Ring'));
    await flushPersistedCards();

    const found = await readCachedCards(['Sol Ring', 'Arcane Signet']);
    expect([...found.keys()]).toEqual(['Sol Ring']);
  });

  it('queues writes rather than hitting disk per card, then flushes as one batch', async () => {
    persistCard('A', makeCard('A'));
    persistCard('B', makeCard('B'));
    persistCard('C', makeCard('C'));

    // Nothing on disk yet — a deck generation resolving hundreds of cards must
    // not open hundreds of IDB transactions.
    expect((await readCachedCards(['A', 'B', 'C'])).size).toBe(0);

    await flushPersistedCards();
    expect((await readCachedCards(['A', 'B', 'C'])).size).toBe(3);
  });

  // The TTL matters for prices: a cached card carries the price it had when it
  // was fetched, and a stale one must not outlive its usefulness.
  it('treats an entry past the 7-day TTL as a miss', async () => {
    persistCard('Sol Ring', makeCard('Sol Ring'));
    await flushPersistedCards();

    const eightDays = 8 * 24 * 60 * 60 * 1000;
    // Date.now spy rather than fake timers, for the reason above.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + eightDays);
    const found = await readCachedCards(['Sol Ring']);
    vi.restoreAllMocks();

    expect(found.size).toBe(0);
  });

  it('is a silent no-op when IndexedDB is missing entirely', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error — deliberately simulating an environment without IDB.
    delete globalThis.indexedDB;
    _resetCacheForTests();

    try {
      persistCard('Sol Ring', makeCard('Sol Ring'));
      await expect(flushPersistedCards()).resolves.toBeUndefined();
      await expect(readCachedCards(['Sol Ring'])).resolves.toEqual(new Map());
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
