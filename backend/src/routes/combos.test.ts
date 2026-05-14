import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, dbTestsEnabled, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';

const d = dbTestsEnabled ? describe : describe.skip;

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
    { comboId: 'combo-thoracle', oracleId: 'oracle-thassa', cardName: "Thassa's Oracle", position: 0 },
    { comboId: 'combo-thoracle', oracleId: 'oracle-consult', cardName: 'Demonic Consultation', position: 1 },
    { comboId: 'combo-labman', oracleId: 'oracle-thassa', cardName: "Thassa's Oracle", position: 0 },
    { comboId: 'combo-labman', oracleId: 'oracle-labman', cardName: 'Laboratory Maniac', position: 1 },
  ]);
}

beforeAll(async () => {
  if (!dbTestsEnabled) return;
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
  await seedCombos();
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

d('POST /api/combos/match', () => {
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

d('GET /api/combos/:id', () => {
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

d('POST /api/combos/admin/refresh', () => {
  it('403s for non-admins', async () => {
    const cookie = await registerAndGetCookie('combos_grace');
    const res = await request(app).post('/api/combos/admin/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
