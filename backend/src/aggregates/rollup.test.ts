import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'crypto';
import * as schema from '../db/schema';
import { setDbForTesting, closeDb } from '../db';
import { testDatabaseUrl } from '../test-helpers';
import {
  computeCommanderAggregates,
  runRollup,
  type PublishedDeckInput,
  MIN_COMMANDER_DECKS,
  MIN_CARD_INCLUSION_DECKS,
  TOP_CARDS_PER_COMMANDER,
  BRACKET_SAMPLE_MIN,
  BUDGET_BUCKET_SUPPRESS_MIN,
} from './rollup';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Builds one published-deck input. `cards` defaults to an empty mainboard;
 *  pass `{ oracleId, name, usd? }` entries to exercise price/inclusion logic. */
function makeDeck(opts: {
  commanderOracleId: string | null;
  commanderName?: string;
  partnerOracleId?: string;
  partnerName?: string;
  effectiveBracket?: number | null;
  publishedAt?: number;
  cards?: Array<{ oracleId: string; name: string; usd?: string }>;
}): PublishedDeckInput {
  return {
    effectiveBracket: opts.effectiveBracket ?? null,
    publishedAt: opts.publishedAt ?? 0,
    data: {
      commander: opts.commanderOracleId
        ? { oracle_id: opts.commanderOracleId, name: opts.commanderName ?? opts.commanderOracleId }
        : null,
      partnerCommander: opts.partnerOracleId
        ? { oracle_id: opts.partnerOracleId, name: opts.partnerName ?? opts.partnerOracleId }
        : null,
      cards: (opts.cards ?? []).map((c) => ({
        card: { oracle_id: c.oracleId, name: c.name, prices: { usd: c.usd ?? null } },
      })),
      sideboard: [],
    },
  };
}

/** N decks for one commander, no cards/bracket, at a given publishedAt. */
function makeDecks(
  commanderOracleId: string,
  count: number,
  publishedAt = 0
): PublishedDeckInput[] {
  return Array.from({ length: count }, () => makeDeck({ commanderOracleId, publishedAt }));
}

describe('computeCommanderAggregates', () => {
  describe('MIN_COMMANDER_DECKS threshold gate', () => {
    it('drops a group under the threshold (4 decks -> 0 rows)', () => {
      expect(MIN_COMMANDER_DECKS).toBe(5);
      const { stats } = computeCommanderAggregates(makeDecks('cmd-a', 4), 0);
      expect(stats).toHaveLength(0);
    });

    it('writes a row once the threshold clears (5 decks -> 1 row)', () => {
      const { stats } = computeCommanderAggregates(makeDecks('cmd-a', 5), 0);
      expect(stats).toHaveLength(1);
      expect(stats[0].deckCount).toBe(5);
    });
  });

  describe('a deck with no commander oracle id', () => {
    it('is dropped entirely rather than crashing or forming its own group', () => {
      const decks = [...makeDecks('cmd-k', 5), makeDeck({ commanderOracleId: null })];
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats).toHaveLength(1);
      expect(stats[0].deckCount).toBe(5);
    });
  });

  describe('avgBracket / bracketSampleCount fold', () => {
    it('suppresses avgBracket under BRACKET_SAMPLE_MIN but still exposes the sample count', () => {
      expect(BRACKET_SAMPLE_MIN).toBe(3);
      const decks = [
        ...makeDecks('cmd-b', 3), // no bracket
        makeDeck({ commanderOracleId: 'cmd-b', effectiveBracket: 3 }),
        makeDeck({ commanderOracleId: 'cmd-b', effectiveBracket: 4 }),
      ]; // 5 decks total, exactly 2 carry a bracket
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats[0].bracketSampleCount).toBe(2);
      expect(stats[0].avgBracket).toBeNull();
    });

    it('exposes the real mean once BRACKET_SAMPLE_MIN is cleared (exactly 3 samples)', () => {
      const decks = [
        ...makeDecks('cmd-c', 2), // no bracket
        makeDeck({ commanderOracleId: 'cmd-c', effectiveBracket: 2 }),
        makeDeck({ commanderOracleId: 'cmd-c', effectiveBracket: 3 }),
        makeDeck({ commanderOracleId: 'cmd-c', effectiveBracket: 4 }),
      ]; // 5 decks, exactly 3 carry a bracket -> mean 3
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats[0].bracketSampleCount).toBe(3);
      expect(stats[0].avgBracket).toBe(3);
    });

    it('a group with zero bracketed decks -> avgBracket null, bracketSampleCount 0', () => {
      const { stats } = computeCommanderAggregates(makeDecks('cmd-d', 5), 0);
      expect(stats[0].bracketSampleCount).toBe(0);
      expect(stats[0].avgBracket).toBeNull();
    });
  });

  describe('budget-bucket fold', () => {
    it('suppresses exactly 1 to null, keeps exactly 0 as a real 0, keeps exactly 2 as a real integer', () => {
      expect(BUDGET_BUCKET_SUPPRESS_MIN).toBe(2);
      const decks = [
        makeDeck({
          commanderOracleId: 'cmd-e',
          cards: [{ oracleId: 'x1', name: 'X1', usd: '50.00' }],
        }), // low: 1
        makeDeck({
          commanderOracleId: 'cmd-e',
          cards: [{ oracleId: 'x2', name: 'X2', usd: '150.00' }],
        }), // mid
        makeDeck({
          commanderOracleId: 'cmd-e',
          cards: [{ oracleId: 'x3', name: 'X3', usd: '200.00' }],
        }), // mid: 2
        makeDeck({ commanderOracleId: 'cmd-e', cards: [{ oracleId: 'x4', name: 'X4' }] }), // no usd -> excluded
        makeDeck({ commanderOracleId: 'cmd-e', cards: [{ oracleId: 'x5', name: 'X5' }] }),
        makeDeck({ commanderOracleId: 'cmd-e', cards: [{ oracleId: 'x6', name: 'X6' }] }),
      ];
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats[0].deckCount).toBe(6);
      expect(stats[0].budgetLowCount).toBeNull(); // exactly 1 -> suppressed
      expect(stats[0].budgetMidCount).toBe(2); // exactly 2 -> real integer
      expect(stats[0].budgetHighCount).toBe(0); // exactly 0 -> real 0, never null
    });

    it('excludes a deck with no parseable card price from every bucket denominator', () => {
      const decks = [
        makeDeck({
          commanderOracleId: 'cmd-p',
          cards: [{ oracleId: 'y1', name: 'Y1', usd: '10.00' }],
        }),
        makeDeck({
          commanderOracleId: 'cmd-p',
          cards: [{ oracleId: 'y2', name: 'Y2', usd: '20.00' }],
        }),
        // Neither of these two decks carries a parseable usd anywhere.
        makeDeck({ commanderOracleId: 'cmd-p', cards: [{ oracleId: 'y3', name: 'Y3' }] }),
        makeDeck({ commanderOracleId: 'cmd-p', cards: [] }),
        makeDeck({
          commanderOracleId: 'cmd-p',
          cards: [{ oracleId: 'y4', name: 'Y4', usd: '30.00' }],
        }),
      ];
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats[0].deckCount).toBe(5);
      // 3 priced decks land in low; the 2 unpriced decks count toward
      // neither bucket (not silently treated as "$0 -> low").
      expect(stats[0].budgetLowCount).toBe(3);
      expect(stats[0].budgetMidCount).toBe(0);
      expect(stats[0].budgetHighCount).toBe(0);
    });

    it('buckets exact $100/$400 sums as inclusive-low (100 -> mid, 400 -> high, not the band below)', () => {
      const decks = [
        ...Array.from({ length: 2 }, (_, i) =>
          makeDeck({
            commanderOracleId: 'cmd-f',
            cards: [{ oracleId: `lo${i}`, name: `Lo${i}`, usd: '10.00' }],
          })
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          makeDeck({
            commanderOracleId: 'cmd-f',
            cards: [{ oracleId: `mi${i}`, name: `Mi${i}`, usd: '100.00' }],
          })
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          makeDeck({
            commanderOracleId: 'cmd-f',
            cards: [{ oracleId: `hi${i}`, name: `Hi${i}`, usd: '400.00' }],
          })
        ),
      ];
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats[0].deckCount).toBe(6);
      expect(stats[0].budgetLowCount).toBe(2);
      expect(stats[0].budgetMidCount).toBe(2); // $100.00 exactly -> mid, not low
      expect(stats[0].budgetHighCount).toBe(2); // $400.00 exactly -> high, not mid
    });
  });

  describe('topCards / card inclusion', () => {
    it('applies MIN_CARD_INCLUSION_DECKS (1/6 decks excluded, 2/6 included)', () => {
      expect(MIN_CARD_INCLUSION_DECKS).toBe(2);
      const decks = [
        makeDeck({ commanderOracleId: 'cmd-h', cards: [{ oracleId: 'rare', name: 'Rare Card' }] }),
        makeDeck({
          commanderOracleId: 'cmd-h',
          cards: [{ oracleId: 'common', name: 'Common Card' }],
        }),
        makeDeck({
          commanderOracleId: 'cmd-h',
          cards: [{ oracleId: 'common', name: 'Common Card' }],
        }),
        makeDeck({ commanderOracleId: 'cmd-h', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-h', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-h', cards: [] }),
      ];
      const { cardInclusion } = computeCommanderAggregates(decks, 0);
      const oracleIds = cardInclusion.map((c) => c.oracleId);
      expect(oracleIds).toContain('common');
      expect(oracleIds).not.toContain('rare');
    });

    it('counts a card once per deck even if it appears in multiple mainboard slots', () => {
      const decks = [
        makeDeck({
          commanderOracleId: 'cmd-dup',
          cards: [
            { oracleId: 'plains', name: 'Plains' },
            { oracleId: 'plains', name: 'Plains' },
            { oracleId: 'plains', name: 'Plains' },
          ],
        }),
        makeDeck({ commanderOracleId: 'cmd-dup', cards: [{ oracleId: 'plains', name: 'Plains' }] }),
        makeDeck({ commanderOracleId: 'cmd-dup', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-dup', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-dup', cards: [] }),
      ];
      const { cardInclusion } = computeCommanderAggregates(decks, 0);
      expect(cardInclusion).toHaveLength(1);
      expect(cardInclusion[0].deckCount).toBe(2); // 2 decks contain it, not 4 copies
    });

    it('caps topCards at TOP_CARDS_PER_COMMANDER and breaks ties by cardName ascending', () => {
      expect(TOP_CARDS_PER_COMMANDER).toBe(15);
      // 20 distinct cards, all included in exactly the same 2 of 5 decks --
      // every count ties at 2, so a correct sort must order purely by name.
      const sharedCards = Array.from({ length: 20 }, (_, i) => ({
        oracleId: `card-${i}`,
        // Reverse-alphabetical insertion order so a stable sort must reorder them.
        name: `Card ${String.fromCharCode(90 - i)}`,
      }));
      const decks = [
        makeDeck({ commanderOracleId: 'cmd-i', cards: sharedCards }),
        makeDeck({ commanderOracleId: 'cmd-i', cards: sharedCards }),
        makeDeck({ commanderOracleId: 'cmd-i', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-i', cards: [] }),
        makeDeck({ commanderOracleId: 'cmd-i', cards: [] }),
      ];
      const { cardInclusion } = computeCommanderAggregates(decks, 0);
      expect(cardInclusion).toHaveLength(15);
      const names = cardInclusion.map((c) => c.cardName);
      expect(names).toEqual([...names].sort());
      expect(cardInclusion.every((c) => c.deckCount === 2)).toBe(true);
      expect(cardInclusion.map((c) => c.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    });
  });

  describe('newLast7d windowing', () => {
    it('counts strictly after the 7x24h boundary, excluding a deck published exactly at it', () => {
      const now = 1_000_000_000_000;
      const decks = [
        makeDeck({ commanderOracleId: 'cmd-j', publishedAt: now - SEVEN_DAYS_MS }), // exactly at boundary -> excluded
        makeDeck({ commanderOracleId: 'cmd-j', publishedAt: now - SEVEN_DAYS_MS + 1 }), // 1ms inside -> included
        makeDeck({ commanderOracleId: 'cmd-j', publishedAt: now - SEVEN_DAYS_MS - 1000 }), // older -> excluded
        makeDeck({ commanderOracleId: 'cmd-j', publishedAt: now }),
        makeDeck({ commanderOracleId: 'cmd-j', publishedAt: now }),
      ];
      const { stats } = computeCommanderAggregates(decks, now);
      expect(stats[0].deckCount).toBe(5);
      expect(stats[0].newLast7d).toBe(3);
    });
  });

  describe('partner-pair grouping', () => {
    it('groups A+B and B+A into one commander_key', () => {
      const decks = [
        ...Array.from({ length: 3 }, () =>
          makeDeck({ commanderOracleId: 'a', partnerOracleId: 'b' })
        ),
        ...Array.from({ length: 2 }, () =>
          makeDeck({ commanderOracleId: 'b', partnerOracleId: 'a' })
        ),
      ];
      const { stats } = computeCommanderAggregates(decks, 0);
      expect(stats).toHaveLength(1);
      expect(stats[0].deckCount).toBe(5);
    });
  });
});

let pool: Pool;
let schemaName: string;

async function seedUser(userId: string): Promise<void> {
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $1, $2)`, [
    userId,
    Date.now(),
  ]);
}

interface SeedDeckOpts {
  userId: string;
  deckId: string;
  commanderOracleId: string;
  bracket?: number | null;
  publishedAt?: number;
  unpublishedAt?: number | null;
  deckDeletedAt?: number | null;
}

async function seedPublishedDeck(opts: SeedDeckOpts): Promise<void> {
  const now = Date.now();
  const data = {
    commander: { oracle_id: opts.commanderOracleId, name: opts.commanderOracleId },
    partnerCommander: null,
    cards: [],
    sideboard: [],
  };
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, deleted_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)`,
    [opts.userId, opts.deckId, JSON.stringify(data), opts.deckDeletedAt ?? null, now]
  );
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, bracket, published_at, updated_at, unpublished_at)
     VALUES ($1, $2, $3, 'Test Deck', 'commander', $4, $5, $6, $7)`,
    [
      opts.userId,
      opts.deckId,
      `slug-${opts.deckId}`,
      opts.bracket ?? null,
      opts.publishedAt ?? now,
      now,
      opts.unpublishedAt ?? null,
    ]
  );
}

describe('runRollup (db)', () => {
  beforeAll(async () => {
    schemaName = `t_${crypto.randomBytes(6).toString('hex')}`;
    pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schemaName}`).catch(() => {});
    });
    await pool.query(`SET search_path TO ${schemaName}`);
    await pool.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE user_decks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        data JSONB,
        rev BIGINT NOT NULL,
        deleted_at BIGINT,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE deck_publications (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deck_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        deck_name TEXT NOT NULL,
        format TEXT NOT NULL,
        bracket INTEGER,
        published_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        unpublished_at BIGINT,
        PRIMARY KEY (user_id, deck_id)
      );
      CREATE TABLE aggregate_rollup_runs (
        id TEXT PRIMARY KEY,
        started_at BIGINT NOT NULL,
        finished_at BIGINT,
        commanders_written INTEGER,
        error TEXT
      );
      CREATE TABLE commander_stats (
        commander_key TEXT PRIMARY KEY,
        commander_name TEXT NOT NULL,
        partner_name TEXT,
        commander_oracle_id TEXT NOT NULL,
        partner_oracle_id TEXT,
        deck_count INTEGER NOT NULL,
        new_last_7d INTEGER NOT NULL DEFAULT 0,
        avg_bracket REAL,
        bracket_sample_count INTEGER NOT NULL DEFAULT 0,
        budget_low_count INTEGER,
        budget_mid_count INTEGER,
        budget_high_count INTEGER,
        computed_at BIGINT NOT NULL
      );
      CREATE TABLE commander_card_inclusion (
        commander_key TEXT NOT NULL REFERENCES commander_stats(commander_key) ON DELETE CASCADE,
        oracle_id TEXT NOT NULL,
        card_name TEXT NOT NULL,
        deck_count INTEGER NOT NULL,
        rank INTEGER NOT NULL,
        PRIMARY KEY (commander_key, oracle_id)
      );
    `);
    setDbForTesting(pool, drizzle(pool, { schema }));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await closeDb();
    }
  });

  it('writes commander_stats + commander_card_inclusion for a qualifying commander', async () => {
    for (let i = 0; i < 5; i++) {
      await seedUser(`user-${i}`);
      await seedPublishedDeck({
        userId: `user-${i}`,
        deckId: `deck-${i}`,
        commanderOracleId: 'cmd-x',
        bracket: 3,
      });
    }
    const result = await runRollup();
    expect(result.commandersWritten).toBe(1);
    const stats = await pool.query('SELECT * FROM commander_stats');
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0].deck_count).toBe(5);
    const runs = await pool.query('SELECT * FROM aggregate_rollup_runs WHERE id = $1', [
      result.runId,
    ]);
    expect(runs.rows[0].finished_at).not.toBeNull();
    expect(runs.rows[0].error).toBeNull();
  });

  it('a second run replaces rather than duplicates the prior rows (proves TRUNCATE order)', async () => {
    await runRollup();
    const stats = await pool.query('SELECT * FROM commander_stats');
    expect(stats.rows).toHaveLength(1); // still 1, not 2
  });

  it('excludes an unpublished deck', async () => {
    await seedUser('user-unpub');
    await seedPublishedDeck({
      userId: 'user-unpub',
      deckId: 'deck-unpub',
      commanderOracleId: 'cmd-y',
      unpublishedAt: Date.now(),
    });
    await runRollup();
    const stats = await pool.query("SELECT * FROM commander_stats WHERE commander_key = 'cmd-y'");
    expect(stats.rows).toHaveLength(0);
  });

  it('excludes a deck_publications row whose own deck is tombstoned', async () => {
    await seedUser('user-tomb');
    await seedPublishedDeck({
      userId: 'user-tomb',
      deckId: 'deck-tomb',
      commanderOracleId: 'cmd-z',
      deckDeletedAt: Date.now(),
    });
    await runRollup();
    const stats = await pool.query("SELECT * FROM commander_stats WHERE commander_key = 'cmd-z'");
    expect(stats.rows).toHaveLength(0);
  });
});
