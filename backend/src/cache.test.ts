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
