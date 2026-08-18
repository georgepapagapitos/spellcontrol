import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { ScryfallCache, colorIdentityMask, toMatchExpression } from './cache';
import type { ScryfallCard } from './types';

function card(overrides: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

let dir: string;
let cache: ScryfallCache;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-search-test-'));
  cache = new ScryfallCache(path.join(dir, 'cards.db'));
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('toMatchExpression', () => {
  it('requires every term, so a plain effect phrase matches padded rules text', () => {
    expect(toMatchExpression('destroy artifact')).toBe('"destroy" AND "artifact"');
  });

  it('neutralises FTS5 syntax rather than erroring on it', () => {
    // The caller is a language model; a stray quote or star must degrade into a
    // word search, never `fts5: syntax error`.
    expect(toMatchExpression('destroy "target" artifact*')).toBe(
      '"destroy" AND "target" AND "artifact"'
    );
    // Operator words are quoted, so they are literal terms, not FTS5 operators.
    expect(toMatchExpression('sacrifice OR draw')).toBe('"sacrifice" AND "OR" AND "draw"');
  });

  it('returns null when nothing searchable survives', () => {
    expect(toMatchExpression('')).toBeNull();
    expect(toMatchExpression('   ')).toBeNull();
    expect(toMatchExpression('*^()')).toBeNull();
  });
});

describe('colorIdentityMask', () => {
  it('is 0 for colourless, which is a subset of every identity', () => {
    expect(colorIdentityMask([])).toBe(0);
    expect(colorIdentityMask(undefined)).toBe(0);
  });

  it('ORs the colour bits', () => {
    expect(colorIdentityMask(['B'])).toBe(4);
    expect(colorIdentityMask(['B', 'G'])).toBe(20);
    expect(colorIdentityMask(['W', 'U', 'B', 'R', 'G'])).toBe(31);
  });
});

describe('searchCards', () => {
  beforeEach(() => {
    cache.setMany([
      card({
        id: 'id-naturalize',
        name: 'Naturalize',
        oracle_id: 'o-naturalize',
        type_line: 'Instant',
        oracle_text: 'Destroy target artifact or enchantment.',
        color_identity: ['G'],
        cmc: 2,
      }),
      card({
        id: 'id-shatter',
        name: 'Shatter',
        oracle_id: 'o-shatter',
        type_line: 'Instant',
        oracle_text: 'Destroy target artifact.',
        color_identity: ['R'],
        cmc: 2,
      }),
      card({
        id: 'id-bolt',
        name: 'Lightning Bolt',
        oracle_id: 'o-bolt',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        color_identity: ['R'],
        cmc: 1,
      }),
      card({
        id: 'id-relic',
        name: 'Relic of Progenitus',
        oracle_id: 'o-relic',
        type_line: 'Artifact',
        oracle_text: 'Exile target card from a graveyard.',
        color_identity: [],
        cmc: 1,
      }),
      card({
        id: 'id-banned',
        name: 'Balance',
        oracle_id: 'o-balance',
        type_line: 'Sorcery',
        oracle_text: 'Destroy target artifact for balance.',
        color_identity: ['W'],
        cmc: 2,
        legalities: { commander: 'banned' },
      }),
    ]);
  });

  it('finds cards by their oracle text', () => {
    const names = cache.searchCards({ query: 'destroy target artifact' }).map((r) => r.name);
    expect(names).toContain('Shatter');
    expect(names).toContain('Naturalize');
    expect(names).not.toContain('Lightning Bolt');
  });

  it('returns the oracle text it matched on, so the caller can quote it safely', () => {
    const [hit] = cache.searchCards({ query: 'lightning bolt damage' });
    expect(hit.name).toBe('Lightning Bolt');
    expect(hit.oracleText).toContain('3 damage');
    expect(hit.typeLine).toBe('Instant');
    expect(hit.cmc).toBe(1);
  });

  it('restricts to a commander colour identity, keeping colourless', () => {
    const names = cache
      .searchCards({ query: 'destroy target artifact', colorIdentity: ['B', 'G'] })
      .map((r) => r.name);
    expect(names).toContain('Naturalize'); // mono-green, fits Golgari
    expect(names).not.toContain('Shatter'); // red, does not

    const colourless = cache
      .searchCards({ query: 'exile target card graveyard', colorIdentity: ['B', 'G'] })
      .map((r) => r.name);
    expect(colourless).toContain('Relic of Progenitus');
  });

  it('can drop cards that are not Commander-legal', () => {
    const all = cache.searchCards({ query: 'destroy target artifact' }).map((r) => r.name);
    expect(all).toContain('Balance');

    const legal = cache
      .searchCards({ query: 'destroy target artifact', commanderLegalOnly: true })
      .map((r) => r.name);
    expect(legal).not.toContain('Balance');
  });

  it('filters by type line', () => {
    const names = cache
      .searchCards({ query: 'destroy target artifact', typeLine: 'Sorcery' })
      .map((r) => r.name);
    expect(names).toEqual(['Balance']);
  });

  it('excludes cards the deck already runs', () => {
    const names = cache
      .searchCards({ query: 'destroy target artifact', exclude: ['Shatter'] })
      .map((r) => r.name);
    expect(names).not.toContain('Shatter');
    expect(names).toContain('Naturalize');
  });

  it('still returns results when the deck already runs the top matches', () => {
    // Excluding AFTER the limit would hand back an empty list here, which reads
    // as "no such card exists" rather than "you already run them".
    const hits = cache.searchCards({
      query: 'destroy target artifact',
      exclude: ['Shatter', 'Balance'],
      limit: 1,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Naturalize');
  });

  it('returns one row per oracle card, not per printing', () => {
    cache.setMany([
      card({
        id: 'id-shatter-2',
        name: 'Shatter',
        oracle_id: 'o-shatter',
        type_line: 'Instant',
        oracle_text: 'Destroy target artifact.',
        color_identity: ['R'],
        cmc: 2,
      }),
    ]);
    const hits = cache.searchCards({ query: 'destroy target artifact' });
    expect(hits.filter((r) => r.name === 'Shatter')).toHaveLength(1);
  });

  it('does not accumulate duplicate index rows when a card is re-cached', () => {
    // The price refresh re-caches the same printing routinely; FTS5 has no
    // upsert, so a missing delete would silently multiply the index.
    const again = card({
      id: 'id-shatter',
      name: 'Shatter',
      oracle_id: 'o-shatter',
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact.',
      color_identity: ['R'],
      cmc: 2,
    });
    cache.setMany([again]);
    cache.setMany([again]);
    expect(
      cache.searchCards({ query: 'destroy target artifact' }).filter((r) => r.name === 'Shatter')
    ).toHaveLength(1);
  });

  it('indexes multi-face cards by their face text', () => {
    cache.setMany([
      card({
        id: 'id-dfc',
        name: 'Bala Ged Recovery // Bala Ged Sanctuary',
        oracle_id: 'o-dfc',
        color_identity: ['G'],
        card_faces: [
          {
            name: 'Bala Ged Recovery',
            type_line: 'Sorcery',
            oracle_text: 'Return target card from your graveyard to your hand.',
          },
          { name: 'Bala Ged Sanctuary', type_line: 'Land', oracle_text: 'Enters tapped.' },
        ],
      }),
    ]);
    const names = cache
      .searchCards({ query: 'return target card graveyard hand' })
      .map((r) => r.name);
    expect(names).toContain('Bala Ged Recovery // Bala Ged Sanctuary');
  });

  it('is not subject to the price TTL — oracle text does not go stale', () => {
    // Backdate every card well past the 7-day TTL. getCheapestByName would miss;
    // search must not, or results would evaporate as rows aged out.
    const db = new Database(path.join(dir, 'cards.db'));
    db.prepare('UPDATE cards SET cached_at = ?').run(Date.now() - 400 * 24 * 60 * 60 * 1000);
    db.close();

    const reopened = new ScryfallCache(path.join(dir, 'cards.db'));
    try {
      expect(reopened.getCheapestByName('Shatter')).toBeNull();
      expect(reopened.searchCards({ query: 'destroy target artifact' }).length).toBeGreaterThan(0);
    } finally {
      reopened.close();
    }
  });

  it('prefers an all-terms match when one exists', () => {
    // Both Shatter and Lightning Bolt contain "target"; only Shatter has all
    // three terms, so the strict pass must win outright.
    const names = cache.searchCards({ query: 'destroy target artifact' }).map((r) => r.name);
    expect(names).toContain('Shatter');
    expect(names).not.toContain('Lightning Bolt');
  });

  it('falls back to a partial match rather than returning nothing', () => {
    // No card contains all of these words. Returning [] would send the caller
    // back to reciting cards from memory — the exact failure this index removes.
    const hits = cache.searchCards({ query: 'exile graveyard cards from anywhere instead' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((r) => r.name)).toContain('Relic of Progenitus');
  });

  it('still honours filters on the fallback pass', () => {
    const hits = cache.searchCards({
      query: 'exile graveyard cards from anywhere instead',
      colorIdentity: ['R'],
      commanderLegalOnly: true,
    });
    // Relic is colourless so it survives; nothing outside red may appear.
    for (const h of hits) {
      expect([...h.colorIdentity].every((c) => c === 'R')).toBe(true);
    }
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(cache.searchCards({ query: '   ' })).toEqual([]);
  });

  it('caps the result count', () => {
    expect(cache.searchCards({ query: 'destroy target artifact', limit: 1 })).toHaveLength(1);
  });
});

describe('search index backfill', () => {
  /** Cache `count` cards, then drop the index so reopening must rebuild it. */
  function legacyCacheWithoutIndex(dbPath: string, count: number) {
    const first = new ScryfallCache(dbPath);
    first.setMany(
      Array.from({ length: count }, (_, i) =>
        card({
          id: `id-${String(i).padStart(5, '0')}`,
          name: `Counterspell ${i}`,
          oracle_id: `o-${i}`,
          type_line: 'Instant',
          oracle_text: 'Counter target spell.',
          color_identity: ['U'],
          cmc: 2,
        })
      )
    );
    first.close();
    const raw = new Database(dbPath);
    raw.exec('DROP TABLE card_search');
    raw.close();
  }

  it('indexes cards that were cached before the index existed', () => {
    const dbPath = path.join(dir, 'legacy.db');
    legacyCacheWithoutIndex(dbPath, 1);
    const reopened = new ScryfallCache(dbPath);
    try {
      const names = reopened.searchCards({ query: 'counter target spell' }).map((r) => r.name);
      expect(names).toContain('Counterspell 0');
    } finally {
      reopened.close();
    }
  });

  it('backfills EVERY card, not just the first handful', () => {
    // Regression guard. The first implementation streamed with `.iterate()`,
    // which better-sqlite3 silently invalidates when the loop writes to the same
    // connection: against the real cache it indexed 16 of 107,369 rows and
    // logged success. Any partial-backfill bug of that shape fails here.
    const dbPath = path.join(dir, 'many.db');
    const COUNT = 60;
    legacyCacheWithoutIndex(dbPath, COUNT);

    const reopened = new ScryfallCache(dbPath);
    try {
      const hits = reopened.searchCards({ query: 'counter target spell', limit: 100 });
      expect(hits).toHaveLength(COUNT);
    } finally {
      reopened.close();
    }
  });
});

describe('card_search rowid map (E259)', () => {
  /** How many index rows exist for a printing — 1 unless we leaked duplicates. */
  function indexRowsFor(dbPath: string, scryfallId: string): number {
    const db = new Database(dbPath, { readonly: true });
    try {
      return (
        db
          .prepare('SELECT COUNT(*) AS n FROM card_search WHERE scryfall_id = ?')
          .get(scryfallId) as { n: number }
      ).n;
    } finally {
      db.close();
    }
  }

  it('re-caching a card replaces its index row instead of duplicating it', () => {
    const dbPath = path.join(dir, 'cards.db');
    const c = card({ id: 'x-1', name: 'Sol Ring', oracle_text: 'Add two colorless mana.' });
    cache.setMany([c]);
    cache.setMany([{ ...c, oracle_text: 'Add two colorless mana. Updated.' }]);
    cache.setMany([{ ...c, oracle_text: 'Add two colorless mana. Updated twice.' }]);

    expect(indexRowsFor(dbPath, 'x-1')).toBe(1);
    expect(cache.searchCards({ query: 'updated twice' }).map((r) => r.name)).toContain('Sol Ring');
  });

  it('an index built BEFORE the map still de-duplicates once the map backfills', () => {
    // The upgrade path this fix has to survive: production already holds
    // ~107k card_search rows with no card_search_map. If the backfill did not
    // run, the first reindex of every card would find no rowid, skip the
    // delete, and silently double the index.
    const dbPath = path.join(dir, 'legacy.db');
    const legacy = new ScryfallCache(dbPath);
    const c = card({ id: 'y-1', name: 'Counterspell', oracle_text: 'Counter target spell.' });
    legacy.setMany([c]);
    legacy.close();

    // Simulate the pre-fix on-disk state: index populated, map absent.
    const raw = new Database(dbPath);
    raw.exec('DROP TABLE IF EXISTS card_search_map');
    raw.close();

    const upgraded = new ScryfallCache(dbPath);
    try {
      upgraded.setMany([{ ...c, oracle_text: 'Counter target spell. Revised.' }]);
      expect(indexRowsFor(dbPath, 'y-1')).toBe(1);
    } finally {
      upgraded.close();
    }
  });
});
