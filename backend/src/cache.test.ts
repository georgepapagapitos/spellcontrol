import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ScryfallCache } from './cache';
import type { ScryfallCard } from './types';

function card(id: string, name = 'Sol Ring'): ScryfallCard {
  return {
    id,
    name,
    rarity: 'uncommon',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
  };
}

let dir: string;
let cache: ScryfallCache;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
  cache = new ScryfallCache(path.join(dir, 'sub', 'cards.db'));
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ScryfallCache', () => {
  it('returns an empty map for an empty input', () => {
    expect(cache.getMany([]).size).toBe(0);
  });

  it('round-trips inserted cards', () => {
    const a = card('id-a');
    const b = card('id-b', 'Lightning Bolt');
    cache.setMany([a, b]);
    const got = cache.getMany(['id-a', 'id-b']);
    expect(got.get('id-a')?.name).toBe('Sol Ring');
    expect(got.get('id-b')?.name).toBe('Lightning Bolt');
  });

  it('omits misses', () => {
    cache.setMany([card('a')]);
    const got = cache.getMany(['a', 'missing']);
    expect(got.has('a')).toBe(true);
    expect(got.has('missing')).toBe(false);
  });

  it('reports stats', () => {
    cache.setMany([card('a'), card('b')]);
    const s = cache.stats();
    expect(s.total).toBe(2);
    expect(s.fresh).toBe(2);
  });

  it('creates the parent directory if missing', () => {
    expect(fs.existsSync(path.join(dir, 'sub'))).toBe(true);
  });

  it('drops entries older than the TTL', () => {
    cache.setMany([card('old')]);
    // Backdate the row by 8 days
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE cards SET cached_at = ? WHERE scryfall_id = ?')
      .run(eightDaysAgo, 'old');
    expect(cache.getMany(['old']).size).toBe(0);
    // Stats should still see the row but mark it stale
    const s = cache.stats();
    expect(s.total).toBe(1);
    expect(s.fresh).toBe(0);
  });

  it('skips malformed JSON rows on read', () => {
    cache.setMany([card('a')]);
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE cards SET data = ? WHERE scryfall_id = ?')
      .run('not json', 'a');
    expect(cache.getMany(['a']).size).toBe(0);
  });
});

describe('ScryfallCache rulings', () => {
  const rulings = [
    { published_at: '2020-01-01', comment: 'It does the thing.', source: 'wotc' },
    { published_at: '2021-06-15', comment: 'And the other thing.', source: 'scryfall' },
  ];

  it('round-trips rulings and distinguishes "no rulings" from a miss', () => {
    cache.setRulings('id-a', rulings);
    expect(cache.getRulings('id-a')).toEqual(rulings);
    // An empty array is a real cached answer, not a miss (null).
    cache.setRulings('id-empty', []);
    expect(cache.getRulings('id-empty')).toEqual([]);
    expect(cache.getRulings('never-stored')).toBeNull();
  });

  it('treats rulings older than the TTL as a miss', () => {
    cache.setRulings('id-a', rulings);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE card_rulings SET cached_at = ? WHERE scryfall_id = ?')
      .run(eightDaysAgo, 'id-a');
    expect(cache.getRulings('id-a')).toBeNull();
  });
});

describe('ScryfallCache identifier lookups', () => {
  it('returns an empty map for empty input', () => {
    expect(cache.getManyByKeys([]).size).toBe(0);
    cache.setLookups([]); // no-op, must not throw
  });

  it('resolves an identifier key to its card via the alias table', () => {
    cache.setMany([card('id-a', 'Sol Ring')]);
    cache.setLookups([{ key: 'ns:sol ring|cmr', scryfallId: 'id-a' }]);
    const got = cache.getManyByKeys(['ns:sol ring|cmr']);
    expect(got.get('ns:sol ring|cmr')?.name).toBe('Sol Ring');
  });

  it('omits keys with no alias', () => {
    cache.setMany([card('id-a')]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'id-a' }]);
    const got = cache.getManyByKeys(['n:sol ring', 'n:unknown']);
    expect(got.has('n:sol ring')).toBe(true);
    expect(got.has('n:unknown')).toBe(false);
  });

  it('omits an alias whose underlying card is missing', () => {
    // Alias points at a card we never stored — the JOIN finds nothing.
    cache.setLookups([{ key: 'n:ghost', scryfallId: 'never-stored' }]);
    expect(cache.getManyByKeys(['n:ghost']).size).toBe(0);
  });

  it('drops a stale alias even when the card is fresh', () => {
    cache.setMany([card('id-a')]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'id-a' }]);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE card_lookups SET cached_at = ? WHERE lookup_key = ?')
      .run(eightDaysAgo, 'n:sol ring');
    expect(cache.getManyByKeys(['n:sol ring']).size).toBe(0);
  });

  it('drops an alias when the underlying card is stale', () => {
    cache.setMany([card('id-a')]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'id-a' }]);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE cards SET cached_at = ? WHERE scryfall_id = ?')
      .run(eightDaysAgo, 'id-a');
    expect(cache.getManyByKeys(['n:sol ring']).size).toBe(0);
  });

  it('overwrites an alias on re-resolution to a different printing', () => {
    cache.setMany([card('id-a', 'Sol Ring'), card('id-b', 'Sol Ring')]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'id-a' }]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'id-b' }]);
    expect(cache.getManyByKeys(['n:sol ring']).get('n:sol ring')?.id).toBe('id-b');
  });
});
