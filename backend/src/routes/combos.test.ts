import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { __resetMatchCacheForTesting, __expireDatasetVersionForTesting } from './combos';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import { combos, comboCards, comboIngestRuns } from '../db/schema';

let app: Server;
let cleanup: () => Promise<void>;

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

async function seedCombos(): Promise<void> {
  const db = getDb();
  await db.insert(combos).values([
    {
      id: 'combo-thoracle',
      identity: 'ub',
      produces: ['Win the game'],
      prerequisites: null,
      description: 'Cast Demonic Consultation naming a card not in deck.',
      manaNeeded: '{U}{B}',
      popularity: 5000,
      legalities: { commander: 'legal' },
      cardCount: 2,
      bracket: null,
      updatedAt: Date.now(),
    },
    {
      id: 'combo-labman',
      identity: 'ub',
      produces: ['Win the game'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 800,
      legalities: { commander: 'legal' },
      cardCount: 2,
      bracket: null,
      updatedAt: Date.now(),
    },
  ]);
  await db.insert(comboCards).values([
    {
      comboId: 'combo-thoracle',
      oracleId: 'oracle-thassa',
      cardName: "Thassa's Oracle",
      position: 0,
    },
    {
      comboId: 'combo-thoracle',
      oracleId: 'oracle-consult',
      cardName: 'Demonic Consultation',
      position: 1,
    },
    {
      comboId: 'combo-labman',
      oracleId: 'oracle-thassa',
      cardName: "Thassa's Oracle",
      position: 0,
    },
    {
      comboId: 'combo-labman',
      oracleId: 'oracle-labman',
      cardName: 'Laboratory Maniac',
      position: 1,
    },
  ]);
}

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
  await seedCombos();
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

beforeEach(() => {
  __resetMatchCacheForTesting();
});

describe('POST /api/combos/match with a huge candidate set', () => {
  // A 4,000-card collection touches ~39k combos. Binding those ids into one
  // statement is past Postgres's 32,767-parameter limit and 500ed the request;
  // `/match` is the default matcher now (E560), so this must stay a 200.
  it('answers 200 and reports truncation instead of failing on 33k candidates', async () => {
    const db = getDb();
    const N = 33_000;
    const ids = Array.from({ length: N }, (_, i) => `bulk-${i}`);
    for (let i = 0; i < N; i += 2000) {
      await db.insert(combos).values(
        ids.slice(i, i + 2000).map((id, k) => ({
          id,
          identity: 'c',
          produces: ['Win the game'],
          legalities: { commander: 'legal' },
          popularity: N - i - k,
          cardCount: 1,
          updatedAt: Date.now(),
        }))
      );
    }
    for (let i = 0; i < N; i += 5000) {
      await db.insert(comboCards).values(
        ids.slice(i, i + 5000).map((comboId) => ({
          comboId,
          oracleId: 'oracle-bulk',
          cardName: 'Bulk Card',
          position: 0,
        }))
      );
    }

    const res = await request(app)
      .post('/api/combos/match')
      .send({ ownedOracleIds: ['oracle-bulk'], deckOracleIds: [], format: 'commander' });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
  }, 60_000);
});

describe('POST /api/combos/bracket-tags', () => {
  it('returns the stored tag for known ids and omits unknown ones, signed out', async () => {
    await getDb().update(combos).set({ bracketTag: 'R' }).where(eq(combos.id, 'combo-labman'));
    const res = await request(app)
      .post('/api/combos/bracket-tags')
      .send({ ids: ['combo-labman', 'combo-thoracle', 'nope'] });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual({ 'combo-labman': 'R', 'combo-thoracle': null });
  });

  it('answers an empty list without a query, and 400s a non-array', async () => {
    const empty = await request(app).post('/api/combos/bracket-tags').send({ ids: [] });
    expect(empty.body).toEqual({ tags: {} });
    const bad = await request(app).post('/api/combos/bracket-tags').send({ ids: 'x' });
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/combos/match', () => {
  it('answers a signed-out visitor: the dataset is public and the browser no longer holds it (E560)', async () => {
    const res = await request(app)
      .post('/api/combos/match')
      .send({
        ownedOracleIds: ['oracle-thassa', 'oracle-consult'],
        deckOracleIds: ['oracle-thassa', 'oracle-consult'],
      });
    expect(res.status).toBe(200);
    expect(res.body.inDeck.map((m: { combo: { id: string } }) => m.combo.id)).toEqual([
      'combo-thoracle',
    ]);
    // Two candidates against a 2000 cap: an exact answer, not a partial one.
    expect(res.body.truncated).toBe(false);
  });

  it('400s when ownedOracleIds is missing', async () => {
    const cookie = await registerAndGetCookie('combos_alice');
    const res = await request(app).post('/api/combos/match').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('returns inDeck and oneAway buckets', async () => {
    const cookie = await registerAndGetCookie('combos_bob');
    const res = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send({
        ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman'],
        deckOracleIds: ['oracle-thassa', 'oracle-consult'],
      });
    expect(res.status).toBe(200);
    expect(res.body.inDeck.map((m: { combo: { id: string } }) => m.combo.id)).toEqual([
      'combo-thoracle',
    ]);
    expect(res.body.oneAway.map((m: { combo: { id: string } }) => m.combo.id)).toEqual([
      'combo-labman',
    ]);
    expect(res.body.oneAway[0].missingOracleIds).toEqual(['oracle-labman']);
  });

  it('honors format legality', async () => {
    const cookie = await registerAndGetCookie('combos_carol');
    const res = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send({
        ownedOracleIds: ['oracle-thassa', 'oracle-consult'],
        deckOracleIds: ['oracle-thassa', 'oracle-consult'],
        format: 'modern',
      });
    expect(res.status).toBe(200);
    expect(res.body.inDeck).toEqual([]);
  });

  it('serves identical subsequent requests from the in-memory cache', async () => {
    const cookie = await registerAndGetCookie('combos_henry');
    const body = {
      ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman'],
      deckOracleIds: ['oracle-thassa', 'oracle-consult'],
    };

    const first = await request(app).post('/api/combos/match').set('Cookie', cookie).send(body);
    expect(first.status).toBe(200);
    expect(first.headers['x-combos-cache']).toBe('miss');

    const second = await request(app).post('/api/combos/match').set('Cookie', cookie).send(body);
    expect(second.status).toBe(200);
    expect(second.headers['x-combos-cache']).toBe('hit');
    // Body must be identical to the first response.
    expect(second.body).toEqual(first.body);
  });

  it('a fresh combo ingest invalidates cached responses (dataset version re-keys)', async () => {
    const cookie = await registerAndGetCookie('combos_nora');
    const body = {
      ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman'],
      deckOracleIds: ['oracle-thassa', 'oracle-consult'],
    };

    const first = await request(app).post('/api/combos/match').set('Cookie', cookie).send(body);
    expect(first.headers['x-combos-cache']).toBe('miss');
    const cached = await request(app).post('/api/combos/match').set('Cookie', cookie).send(body);
    expect(cached.headers['x-combos-cache']).toBe('hit');

    // A re-ingest finishes → new dataset version. Expire only the version memo
    // (the response cache is untouched), so a miss here proves the version, not a
    // cleared cache, re-keyed the lookup.
    await getDb()
      .insert(comboIngestRuns)
      .values({
        id: 'run-after',
        startedAt: Date.now(),
        finishedAt: Date.now() + 1000,
        combosWritten: 2,
        source: 'test',
      });
    __expireDatasetVersionForTesting();

    const afterIngest = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send(body);
    expect(afterIngest.headers['x-combos-cache']).toBe('miss');
  });

  it('cache key normalizes oracle-id order — same set in different order is one cache entry', async () => {
    const cookie = await registerAndGetCookie('combos_ivy');

    const a = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send({
        ownedOracleIds: ['oracle-thassa', 'oracle-consult', 'oracle-labman'],
        deckOracleIds: ['oracle-thassa', 'oracle-consult'],
      });
    expect(a.headers['x-combos-cache']).toBe('miss');

    const b = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send({
        // Same ids, different order — should still hit the same cache entry.
        ownedOracleIds: ['oracle-labman', 'oracle-thassa', 'oracle-consult'],
        deckOracleIds: ['oracle-consult', 'oracle-thassa'],
      });
    expect(b.headers['x-combos-cache']).toBe('hit');
  });

  it('returns empty buckets for an empty collection', async () => {
    const cookie = await registerAndGetCookie('combos_dave');
    const res = await request(app)
      .post('/api/combos/match')
      .set('Cookie', cookie)
      .send({ ownedOracleIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.inDeck).toEqual([]);
    expect(res.body.oneAway).toEqual([]);
    expect(res.body.almostInCollection).toEqual([]);
  });
});

describe('GET /api/combos/:id', () => {
  it('returns the combo with its full card list', async () => {
    const cookie = await registerAndGetCookie('combos_eve');
    const res = await request(app).get('/api/combos/combo-thoracle').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('combo-thoracle');
    expect(res.body.cards).toHaveLength(2);
    expect(res.body.cards[0].position).toBe(0);
  });

  it('returns 404 for an unknown combo', async () => {
    const cookie = await registerAndGetCookie('combos_frank');
    const res = await request(app).get('/api/combos/does-not-exist').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/combos/admin/refresh', () => {
  it('403s for non-admins', async () => {
    const cookie = await registerAndGetCookie('combos_grace');
    const res = await request(app).post('/api/combos/admin/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
