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

  // Oracle-only readers (cube pool ranking) pass allowStale: rules text doesn't
  // change, and expiring it would force a pointless Scryfall re-fetch.
  it('returns TTL-expired rows when allowStale is set', () => {
    cache.setMany([card('old')]);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE cards SET cached_at = ? WHERE scryfall_id = ?')
      .run(eightDaysAgo, 'old');
    expect(cache.getMany(['old']).size).toBe(0);
    expect(cache.getMany(['old'], true).get('old')?.name).toBe('Sol Ring');
  });

  // The price refresh serves from the nightly bulk dump instead of hitting
  // Scryfall for every id, so it needs a tighter freshness bar than the 7-day
  // TTL: a row that old means the ingest stopped running, and stale prices are
  // money. See PRICE_MAX_AGE_MS in server.ts.
  describe('maxAgeMs', () => {
    const DAY = 24 * 60 * 60 * 1000;

    function backdate(id: string, ms: number) {
      (
        cache as unknown as {
          db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
        }
      ).db
        .prepare('UPDATE cards SET cached_at = ? WHERE scryfall_id = ?')
        .run(Date.now() - ms, id);
    }

    it('serves a row inside the tighter window', () => {
      cache.setMany([card('fresh')]);
      backdate('fresh', 12 * 60 * 60 * 1000);
      expect(cache.getMany(['fresh'], false, 36 * 60 * 60 * 1000).get('fresh')?.name).toBe(
        'Sol Ring'
      );
    });

    // The one that matters: within the 7-day TTL, so the default read would
    // hand back prices from a dump that stopped arriving days ago.
    it('rejects a row that is inside the TTL but outside the tighter window', () => {
      cache.setMany([card('stale-price')]);
      backdate('stale-price', 3 * DAY);
      expect(cache.getMany(['stale-price']).size).toBe(1); // default TTL: a hit
      expect(cache.getMany(['stale-price'], false, 36 * 60 * 60 * 1000).size).toBe(0);
    });

    it('leaves every existing caller on the 7-day TTL when omitted', () => {
      cache.setMany([card('six-days')]);
      backdate('six-days', 6 * DAY);
      expect(cache.getMany(['six-days']).size).toBe(1);
    });

    it('is ignored when allowStale is set, as for oracle-only readers', () => {
      cache.setMany([card('oracle')]);
      backdate('oracle', 30 * DAY);
      expect(cache.getMany(['oracle'], true, 60 * 60 * 1000).get('oracle')?.name).toBe('Sol Ring');
    });
  });

  it('returns TTL-expired alias lookups when allowStale is set', () => {
    cache.setMany([card('alias-id')]);
    cache.setLookups([{ key: 'n:sol ring', scryfallId: 'alias-id' }]);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const db = (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare('UPDATE cards SET cached_at = ?').run(eightDaysAgo);
    db.prepare('UPDATE card_lookups SET cached_at = ?').run(eightDaysAgo);
    expect(cache.getManyByKeys(['n:sol ring']).size).toBe(0);
    expect(cache.getManyByKeys(['n:sol ring'], true).get('n:sol ring')?.name).toBe('Sol Ring');
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

describe('ScryfallCache.getCheapestByName', () => {
  /** Store a printing the way the bulk ingest does: card row + `ns:`/`nsc:` aliases. */
  function printing(
    id: string,
    name: string,
    set: string,
    prices?: ScryfallCard['prices']
  ): ScryfallCard {
    const c: ScryfallCard = {
      id,
      name,
      rarity: 'rare',
      set,
      set_name: set.toUpperCase(),
      collector_number: '1',
      prices,
    };
    cache.setMany([c]);
    cache.setLookups([
      { key: `ns:${name.toLowerCase()}|${set}`, scryfallId: id },
      { key: `nsc:${name.toLowerCase()}|${set}|1`, scryfallId: id },
    ]);
    return c;
  }

  it('returns null when the name is unknown or blank', () => {
    expect(cache.getCheapestByName('Arena Rector')).toBeNull();
    expect(cache.getCheapestByName('   ')).toBeNull();
  });

  it('picks the cheapest nonfoil USD printing across sets', () => {
    printing('id-2xm', 'Arena Rector', '2xm', { usd: '24.50' });
    printing('id-bro', 'Arena Rector', 'bro', { usd: '18.99' });
    printing('id-sld', 'Arena Rector', 'sld', { usd: null, usd_foil: '5.00' });

    expect(cache.getCheapestByName('Arena Rector')?.id).toBe('id-bro');
  });

  // A foil-only default (Secret Lair et al.) is exactly what made the live path
  // fire a SECOND request to the price-ordered search endpoint.
  it('falls back to the cheapest foil when no printing has a nonfoil price', () => {
    printing('id-a', 'Foily Thing', 'sld', { usd: null, usd_foil: '89.28' });
    printing('id-b', 'Foily Thing', 'slx', { usd: null, usd_foil: '42.00' });

    expect(cache.getCheapestByName('Foily Thing')?.id).toBe('id-b');
  });

  it('returns a printing even when nothing carries a price at all', () => {
    printing('id-a', 'Priceless', 'unk');
    expect(cache.getCheapestByName('Priceless')?.id).toBe('id-a');
  });

  // The prefix scan is the whole trick — it must not bleed into a neighbouring
  // name, and it must not pick up the `nsc:` keys (which sort after every `ns:`).
  it('scans only the requested name, not neighbours or nsc: keys', () => {
    printing('id-rector', 'Arena Rector', 'bro', { usd: '18.99' });
    printing('id-arena', 'Arena', 'unh', { usd: '0.25' });
    printing('id-long', 'Arena Rector of Doom', 'xxx', { usd: '0.01' });

    expect(cache.getCheapestByName('Arena Rector')?.id).toBe('id-rector');
    expect(cache.getCheapestByName('Arena')?.id).toBe('id-arena');
  });

  it('matches case-insensitively and on the front face of a split name', () => {
    printing('id-a', 'Fire', 'apc', { usd: '1.00' });
    expect(cache.getCheapestByName('fire')?.id).toBe('id-a');
    expect(cache.getCheapestByName('Fire // Ice')?.id).toBe('id-a');
  });

  // Callers pass the 36h price window: past it the nightly ingest has been
  // missing runs and the prices shouldn't be quoted as money.
  it('honors a tightened max age', () => {
    printing('id-a', 'Arena Rector', 'bro', { usd: '18.99' });
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    (
      cache as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE cards SET cached_at = ? WHERE scryfall_id = ?')
      .run(twoDaysAgo, 'id-a');

    expect(cache.getCheapestByName('Arena Rector', 36 * 60 * 60 * 1000)).toBeNull();
    expect(cache.getCheapestByName('Arena Rector')?.id).toBe('id-a');
  });
});
