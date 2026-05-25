import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { __resetMatchCacheForTesting } from './combos';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';

let app: Express;
let cleanup: () => Promise<void>;

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
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

describe('POST /api/combos/match', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/combos/match').send({ ownedOracleIds: [] });
    expect(res.status).toBe(401);
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
