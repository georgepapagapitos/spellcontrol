import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, dbTestsEnabled, extractSessionCookie } from '../test-helpers';

const d = dbTestsEnabled ? describe : describe.skip;

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  if (!dbTestsEnabled) return;
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

d('GET /api/sync', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await request(app).get('/api/sync');
    expect(res.status).toBe(401);
  });

  it('returns an empty snapshot for a new user', async () => {
    const cookie = await registerAndGetCookie('sync_alice');
    const res = await request(app).get('/api/sync').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      collection: null,
      binders: [],
      decks: [],
      version: 0,
    });
  });
});

d('PUT /api/sync', () => {
  it('persists the snapshot and bumps the version', async () => {
    const cookie = await registerAndGetCookie('sync_bob');
    const put = await request(app)
      .put('/api/sync')
      .set('Cookie', cookie)
      .send({
        collection: { fileName: 'test.csv', cards: [] },
        binders: [{ id: 'b1', name: 'My binder' }],
        decks: [{ id: 'd1', name: 'My deck' }],
        baseVersion: 0,
      });
    expect(put.status).toBe(200);
    expect(put.body.version).toBe(1);

    const get = await request(app).get('/api/sync').set('Cookie', cookie);
    expect(get.body.binders[0].name).toBe('My binder');
    expect(get.body.decks[0].name).toBe('My deck');
    expect(get.body.version).toBe(1);
  });

  it('rejects writes with a stale baseVersion (409 + current snapshot)', async () => {
    const cookie = await registerAndGetCookie('sync_carol');
    await request(app)
      .put('/api/sync')
      .set('Cookie', cookie)
      .send({ collection: null, binders: [], decks: [], baseVersion: 0 });

    const conflict = await request(app)
      .put('/api/sync')
      .set('Cookie', cookie)
      .send({ collection: null, binders: [{ id: 'x' }], decks: [], baseVersion: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.current.version).toBe(1);
  });

  it('rejects malformed payloads', async () => {
    const cookie = await registerAndGetCookie('sync_dave');
    const res = await request(app)
      .put('/api/sync')
      .set('Cookie', cookie)
      .send({ collection: null, binders: 'not an array', decks: [], baseVersion: 0 });
    expect(res.status).toBe(400);
  });

  it('isolates snapshots per user', async () => {
    const c1 = await registerAndGetCookie('sync_eve');
    const c2 = await registerAndGetCookie('sync_frank');
    await request(app)
      .put('/api/sync')
      .set('Cookie', c1)
      .send({
        collection: null,
        binders: [{ id: 'eve-binder' }],
        decks: [],
        baseVersion: 0,
      });
    const res = await request(app).get('/api/sync').set('Cookie', c2);
    expect(res.body.binders).toEqual([]);
  });
});
