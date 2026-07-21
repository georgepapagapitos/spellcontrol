import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'crypto';
import * as schema from '../db/schema';
import { setDbForTesting, closeDb } from '../db';
import { testDatabaseUrl } from '../test-helpers';
import {
  computeDecayedTrending,
  snapshotDeckStats,
  DECAY_RATE,
  COPY_WEIGHT,
  VIEW_WEIGHT,
  SNAPSHOT_RETENTION_DAYS,
  TRENDING_DECKS_LIMIT,
  type DeckSnapshotRow,
} from './trending-decks';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' for an epoch-ms instant, matching trending-decks.ts's own
 *  UTC-always day bucketing. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

describe('computeDecayedTrending', () => {
  // A fixed "today" so every fixture's ageDays is deterministic.
  const now = Date.parse('2026-07-10T00:00:00.000Z');

  describe('first-snapshot semantics (the headline fix)', () => {
    it('a lone first-ever snapshot contributes zero score, however large its cumulative counts', () => {
      const rows: DeckSnapshotRow[] = [
        { deckId: 'd1', day: '2026-07-01', viewCount: 500, copyCount: 40 },
      ];
      expect(computeDecayedTrending(rows, now)).toEqual([]);
    });

    it('a second day of snapshots produces a real, small delta scored normally', () => {
      const rows: DeckSnapshotRow[] = [
        { deckId: 'd1', day: '2026-07-01', viewCount: 500, copyCount: 40 },
        { deckId: 'd1', day: '2026-07-02', viewCount: 520, copyCount: 42 },
      ];
      const result = computeDecayedTrending(rows, now);
      // viewDelta 20, copyDelta 2 -- (2*3 + 20*1) * DECAY_RATE**ageDays.
      const ageDays = Math.floor((now - Date.parse('2026-07-02T00:00:00.000Z')) / DAY_MS);
      expect(result).toEqual([
        { deckId: 'd1', score: (2 * COPY_WEIGHT + 20 * VIEW_WEIGHT) * DECAY_RATE ** ageDays },
      ]);
    });
  });

  it('decays monotonically -- a back-loaded deck outscores a front-loaded one with the same total delta', () => {
    const rows: DeckSnapshotRow[] = [
      // Front-loaded: the whole +10-copy delta happened 6 days ago.
      { deckId: 'front', day: '2026-07-03', viewCount: 0, copyCount: 0 },
      { deckId: 'front', day: '2026-07-04', viewCount: 0, copyCount: 10 },
      // Back-loaded: the same +10-copy delta happened yesterday.
      { deckId: 'back', day: '2026-07-09', viewCount: 0, copyCount: 0 },
      { deckId: 'back', day: '2026-07-10', viewCount: 0, copyCount: 10 },
    ];
    const result = computeDecayedTrending(rows, now);
    const front = result.find((r) => r.deckId === 'front')!;
    const back = result.find((r) => r.deckId === 'back')!;
    expect(front).toBeTruthy();
    expect(back).toBeTruthy();
    expect(back.score).toBeGreaterThan(front.score);
  });

  it('weights 1 copy the same as 3 views, same day', () => {
    const rows: DeckSnapshotRow[] = [
      { deckId: 'copy-heavy', day: '2026-07-09', viewCount: 0, copyCount: 0 },
      { deckId: 'copy-heavy', day: '2026-07-10', viewCount: 0, copyCount: 1 },
      { deckId: 'view-heavy', day: '2026-07-09', viewCount: 0, copyCount: 0 },
      { deckId: 'view-heavy', day: '2026-07-10', viewCount: 3, copyCount: 0 },
    ];
    const result = computeDecayedTrending(rows, now);
    const copyHeavy = result.find((r) => r.deckId === 'copy-heavy')!;
    const viewHeavy = result.find((r) => r.deckId === 'view-heavy')!;
    expect(copyHeavy.score).toBe(viewHeavy.score);
    expect(copyHeavy.score).toBeGreaterThan(0);
  });

  it("floors a decreased counter at 0 -- it never subtracts from the other field's contribution", () => {
    const rows: DeckSnapshotRow[] = [
      { deckId: 'mixed', day: '2026-07-09', viewCount: 100, copyCount: 50 },
      // view count dropped (a correction/reset); copy count still rose by 10.
      { deckId: 'mixed', day: '2026-07-10', viewCount: 90, copyCount: 60 },
    ];
    const result = computeDecayedTrending(rows, now);
    // If the view drop wrongly subtracted, this would be less than 10*COPY_WEIGHT.
    expect(result).toEqual([{ deckId: 'mixed', score: 10 * COPY_WEIGHT * DECAY_RATE ** 0 }]);
  });

  it('excludes a zero-score deck entirely rather than returning it at score 0', () => {
    const rows: DeckSnapshotRow[] = [
      { deckId: 'flat', day: '2026-07-09', viewCount: 10, copyCount: 10 },
      { deckId: 'flat', day: '2026-07-10', viewCount: 10, copyCount: 10 }, // no movement
      { deckId: 'real', day: '2026-07-09', viewCount: 0, copyCount: 0 },
      { deckId: 'real', day: '2026-07-10', viewCount: 5, copyCount: 0 },
    ];
    const result = computeDecayedTrending(rows, now);
    expect(result.map((r) => r.deckId)).toEqual(['real']);
  });

  it('caps at TRENDING_DECKS_LIMIT (20) against a 25-deck fixture, sorted desc by score', () => {
    expect(TRENDING_DECKS_LIMIT).toBe(20);
    const rows: DeckSnapshotRow[] = [];
    for (let i = 0; i < 25; i++) {
      const deckId = `deck-${i}`;
      rows.push({ deckId, day: '2026-07-09', viewCount: 0, copyCount: 0 });
      // Descending delta size so deck-0 scores highest, deck-24 lowest --
      // every pair shares the same day, so decay is identical across decks.
      rows.push({ deckId, day: '2026-07-10', viewCount: 0, copyCount: 25 - i });
    }
    const result = computeDecayedTrending(rows, now);
    expect(result).toHaveLength(20);
    expect(result.map((r) => r.deckId)).toEqual(Array.from({ length: 20 }, (_, i) => `deck-${i}`));
    for (let i = 1; i < result.length; i++) {
      expect(result[i].score).toBeLessThanOrEqual(result[i - 1].score);
    }
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

async function seedPublishedDeck(opts: {
  userId: string;
  deckId: string;
  viewCount: number;
  copyCount: number;
  unpublishedAt?: number | null;
}): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, view_count, copy_count, published_at, updated_at, unpublished_at)
     VALUES ($1, $2, $3, 'Test Deck', 'commander', $4, $5, $6, $6, $7)`,
    [
      opts.userId,
      opts.deckId,
      `slug-${opts.deckId}`,
      opts.viewCount,
      opts.copyCount,
      now,
      opts.unpublishedAt ?? null,
    ]
  );
}

describe('snapshotDeckStats (db)', () => {
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
      CREATE TABLE deck_publications (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deck_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        deck_name TEXT NOT NULL,
        format TEXT NOT NULL,
        view_count INTEGER NOT NULL DEFAULT 0,
        copy_count INTEGER NOT NULL DEFAULT 0,
        published_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        unpublished_at BIGINT,
        PRIMARY KEY (user_id, deck_id)
      );
      CREATE TABLE deck_stat_snapshots (
        deck_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        day DATE NOT NULL,
        view_count INTEGER NOT NULL DEFAULT 0,
        copy_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, day)
      );
      CREATE INDEX deck_stat_snapshots_day_idx ON deck_stat_snapshots(day);
    `);
    setDbForTesting(pool, drizzle(pool, { schema }));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await closeDb();
    }
  });

  it('snapshots every currently-public deck, excluding an unpublished one', async () => {
    await seedUser('user-a');
    await seedUser('user-b');
    await seedPublishedDeck({ userId: 'user-a', deckId: 'deck-a', viewCount: 100, copyCount: 10 });
    await seedPublishedDeck({
      userId: 'user-b',
      deckId: 'deck-b-unpub',
      viewCount: 50,
      copyCount: 5,
      unpublishedAt: Date.now(),
    });

    const now = Date.now();
    const written = await snapshotDeckStats(now);
    expect(written).toBe(1);

    const rows = await pool.query('SELECT * FROM deck_stat_snapshots');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].deck_id).toBe('deck-a');
    expect(rows.rows[0].view_count).toBe(100);
    expect(rows.rows[0].copy_count).toBe(10);
  });

  it('upserts on conflict -- a second run the same day updates rather than duplicates', async () => {
    await pool.query(
      `UPDATE deck_publications SET view_count = 150, copy_count = 15 WHERE deck_id = 'deck-a'`
    );
    const now = Date.now();
    await snapshotDeckStats(now);

    const rows = await pool.query("SELECT * FROM deck_stat_snapshots WHERE deck_id = 'deck-a'");
    expect(rows.rows).toHaveLength(1); // still 1 row for today, not 2
    expect(rows.rows[0].view_count).toBe(150);
    expect(rows.rows[0].copy_count).toBe(15);
  });

  it('prunes snapshots older than SNAPSHOT_RETENTION_DAYS, keeping recent ones', async () => {
    expect(SNAPSHOT_RETENTION_DAYS).toBe(8);
    const now = Date.now();
    const oldDay = day(now - 10 * DAY_MS);
    const recentDay = day(now - 3 * DAY_MS);
    await pool.query(
      `INSERT INTO deck_stat_snapshots (deck_id, user_id, day, view_count, copy_count)
       VALUES ('deck-a', 'user-a', $1, 90, 9), ('deck-a', 'user-a', $2, 95, 9)`,
      [oldDay, recentDay]
    );

    await snapshotDeckStats(now);

    const days = await pool.query(
      "SELECT day::text AS day FROM deck_stat_snapshots WHERE deck_id = 'deck-a' ORDER BY day"
    );
    const dayStrings: string[] = days.rows.map((r: { day: string }) => r.day);
    expect(dayStrings).not.toContain(oldDay);
    expect(dayStrings).toContain(recentDay);
  });
});
