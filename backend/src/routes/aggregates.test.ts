import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import {
  commanderStats,
  commanderCardInclusion,
  userDecks,
  deckPublications,
  deckStatSnapshots,
} from '../db/schema';

let app: Express;
let cleanup: () => Promise<void>;

async function registerUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

async function seedStats(): Promise<void> {
  const db = getDb();
  await db.insert(commanderStats).values([
    {
      commanderKey: 'cmd-atraxa',
      commanderName: "Atraxa, Praetors' Voice",
      partnerName: null,
      commanderOracleId: 'oracle-atraxa',
      partnerOracleId: null,
      deckCount: 120,
      newLast7d: 5,
      avgBracket: 3.4,
      bracketSampleCount: 40,
      budgetLowCount: 20,
      budgetMidCount: null, // exactly-1 fold in effect -- must render as absent, never 0
      budgetHighCount: 0,
      computedAt: Date.now(),
    },
    {
      commanderKey: 'cmd-rising',
      commanderName: 'Rising Commander',
      partnerName: null,
      commanderOracleId: 'oracle-rising',
      partnerOracleId: null,
      deckCount: 10,
      newLast7d: 8,
      avgBracket: null,
      bracketSampleCount: 1,
      budgetLowCount: null,
      budgetMidCount: null,
      budgetHighCount: null,
      computedAt: Date.now(),
    },
  ]);
  await db.insert(commanderCardInclusion).values([
    {
      commanderKey: 'cmd-atraxa',
      oracleId: 'card-1',
      cardName: 'Card One',
      deckCount: 60,
      rank: 1,
    },
    {
      commanderKey: 'cmd-atraxa',
      oracleId: 'card-2',
      cardName: 'Card Two',
      deckCount: 30,
      rank: 2,
    },
  ]);
}

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
  await seedStats();
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe('GET /api/aggregates/commanders/:commanderKey', () => {
  it('returns the full shape for a qualifying commander, with pct computed at read time', async () => {
    const res = await request(app).get('/api/aggregates/commanders/cmd-atraxa');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      commanderKey: 'cmd-atraxa',
      commanderName: "Atraxa, Praetors' Voice",
      partnerName: null,
      deckCount: 120,
      avgBracket: 3.4,
      bracketSampleCount: 40,
      budgetDistribution: { low: 20, mid: null, high: 0 },
    });
    expect(res.body.topCards).toEqual([
      { oracleId: 'card-1', cardName: 'Card One', deckCount: 60, pct: 50 },
      { oracleId: 'card-2', cardName: 'Card Two', deckCount: 30, pct: 25 },
    ]);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('never renders a null budget bucket as zero', async () => {
    const res = await request(app).get('/api/aggregates/commanders/cmd-atraxa');
    expect(res.body.budgetDistribution.mid).toBeNull();
    expect(res.body.budgetDistribution.mid).not.toBe(0);
  });

  it('404s identically for an unknown key and a below-threshold key', async () => {
    const unknown = await request(app).get('/api/aggregates/commanders/does-not-exist');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'Not enough public decks yet.' });

    // Sub-threshold commanders are never written a row at all, so a
    // "below-threshold" key and an "unknown" key are the same lookup miss by
    // construction -- assert a second never-written key gets the identical body.
    const belowThreshold = await request(app).get(
      '/api/aggregates/commanders/never-cleared-threshold'
    );
    expect(belowThreshold.status).toBe(404);
    expect(belowThreshold.body).toEqual(unknown.body);
  });
});

describe('GET /api/aggregates/commanders (batch)', () => {
  it('returns only keys with a row, silently omitting missing keys', async () => {
    const res = await request(app).get(
      '/api/aggregates/commanders?keys=cmd-atraxa,does-not-exist,cmd-rising'
    );
    expect(res.status).toBe(200);
    const keys = res.body.commanders.map((c: { commanderKey: string }) => c.commanderKey).sort();
    expect(keys).toEqual(['cmd-atraxa', 'cmd-rising']);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('returns an empty list for no keys', async () => {
    const res = await request(app).get('/api/aggregates/commanders');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ commanders: [] });
  });

  it('400s when more than 50 keys are requested', async () => {
    const keys = Array.from({ length: 51 }, (_, i) => `k${i}`).join(',');
    const res = await request(app).get(`/api/aggregates/commanders?keys=${keys}`);
    expect(res.status).toBe(400);
  });

  it('accepts exactly 50 keys', async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`).join(',');
    const res = await request(app).get(`/api/aggregates/commanders?keys=${keys}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/aggregates/trending', () => {
  it('returns rising commanders above RISING_MIN_NEW_7D, sorted by newLast7d desc', async () => {
    const res = await request(app).get('/api/aggregates/trending');
    expect(res.status).toBe(200);
    expect(res.body.risingCommanders.map((c: { commanderKey: string }) => c.commanderKey)).toEqual([
      'cmd-rising', // newLast7d 8
      'cmd-atraxa', // newLast7d 5
    ]);
    expect(res.body).not.toHaveProperty('topCopiedDecks');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});

describe('GET /api/aggregates/trending (topCopiedDecks, w4-trending)', () => {
  it('gains topCopiedDecks once real snapshot deltas exist', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'trending_owner', password: 'correct horse battery' });
    const ownerId = reg.body.user.id as string;
    const db = getDb();
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    await db.insert(deckPublications).values({
      userId: ownerId,
      deckId: 'trend-deck-1',
      slug: 'trend-deck-1-slug',
      deckName: 'Trend Deck One',
      format: 'commander',
      commanderName: 'Trend Commander',
      colorIdentity: [],
      cardCount: 0,
      viewCount: 520,
      copyCount: 42,
      likeCount: 0,
      deckRev: 1,
      publishedAt: now,
      updatedAt: now,
      unpublishedAt: null,
    });
    await db.insert(deckStatSnapshots).values([
      {
        deckId: 'trend-deck-1',
        userId: ownerId,
        day: dayStr(now - DAY_MS),
        viewCount: 500,
        copyCount: 40,
      },
      { deckId: 'trend-deck-1', userId: ownerId, day: dayStr(now), viewCount: 520, copyCount: 42 },
    ]);

    const res = await request(app).get('/api/aggregates/trending');
    expect(res.status).toBe(200);
    expect(res.body.topCopiedDecks).toHaveLength(1);
    expect(res.body.topCopiedDecks[0]).toMatchObject({
      deckId: 'trend-deck-1',
      slug: 'trend-deck-1-slug',
      deckName: 'Trend Deck One',
      commanderName: 'Trend Commander',
      partnerName: null,
    });
    expect(res.body.topCopiedDecks[0].score).toBeGreaterThan(0);
  });
});

describe('POST /api/aggregates/admin/refresh (auth gating)', () => {
  it('401s anonymously', async () => {
    const res = await request(app).post('/api/aggregates/admin/refresh');
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin authed user', async () => {
    const cookie = await registerUser('aggregates_plain');
    const res = await request(app).post('/api/aggregates/admin/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});

// Declared LAST and deliberately reuses the shared `app`/schema above rather
// than seeding its own: runRollup() TRUNCATEs commander_stats wholesale, so
// this must run only after every fixture-dependent assertion elsewhere in
// this file has already executed (vitest runs `it`/`describe` blocks within
// one file sequentially, in declaration order).
describe('POST /api/aggregates/admin/refresh (runs the rollup)', () => {
  it('invokes runRollup() against seeded fixture decks for an admin', async () => {
    const adminReg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'aggregates_admin', password: 'correct horse battery' });
    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = 'aggregates_admin'`);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'aggregates_admin', password: 'correct horse battery' });
    const adminCookie = extractSessionCookie(login.headers['set-cookie'])!;
    const ownerId = adminReg.body.user.id as string;

    const db = getDb();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await db.insert(userDecks).values({
        userId: ownerId,
        id: `refresh-deck-${i}`,
        data: {
          commander: { oracle_id: 'oracle-refresh', name: 'Refresh Commander' },
          partnerCommander: null,
          cards: [],
          sideboard: [],
        },
        rev: 1,
        deletedAt: null,
        updatedAt: now,
      });
      await db.insert(deckPublications).values({
        userId: ownerId,
        deckId: `refresh-deck-${i}`,
        slug: `refresh-slug-${i}`,
        deckName: 'Refresh Deck',
        format: 'commander',
        bracket: null,
        publishedAt: now,
        updatedAt: now,
        unpublishedAt: null,
      });
    }

    const res = await request(app).post('/api/aggregates/admin/refresh').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.commandersWritten).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.runId).toBe('string');

    const check = await request(app).get('/api/aggregates/commanders/oracle-refresh');
    expect(check.status).toBe(200);
    expect(check.body.deckCount).toBe(5);
  });
});
