import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
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

describe('GET /api/sync', () => {
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

describe('PUT /api/sync', () => {
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

describe('collection-wipe backups', () => {
  const coll = (n: number) => ({ fileName: 'c.csv', cards: Array.from({ length: n }, () => ({})) });
  const put = (cookie: string, body: object) =>
    request(app).put('/api/sync').set('Cookie', cookie).send(body);

  it('stashes a backup when a non-empty collection is wiped, and not otherwise', async () => {
    const cookie = await registerAndGetCookie('bk_alice');
    // Populate, then a non-wipe change → no backup.
    await put(cookie, { collection: coll(3), binders: [], decks: [], baseVersion: 0 });
    await put(cookie, { collection: coll(5), binders: [], decks: [], baseVersion: 1 });
    let list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    expect(list.body.backups).toEqual([]);

    // Now wipe (null over a non-empty stored collection) → one backup.
    const wipe = await put(cookie, { collection: null, binders: [], decks: [], baseVersion: 2 });
    expect(wipe.status).toBe(200);
    list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    expect(list.body.backups).toHaveLength(1);
    expect(list.body.backups[0]).toMatchObject({
      reason: 'collection-wipe',
      priorVersion: 2,
      priorCardCount: 5,
    });
  });

  it('does not back up when the prior collection was already empty', async () => {
    const cookie = await registerAndGetCookie('bk_bob');
    await put(cookie, { collection: null, binders: [], decks: [], baseVersion: 0 });
    await put(cookie, { collection: { cards: [] }, binders: [], decks: [], baseVersion: 1 });
    const list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    expect(list.body.backups).toEqual([]);
  });

  it('keeps only the 3 most recent backups (ring)', async () => {
    const cookie = await registerAndGetCookie('bk_carol');
    let v = 0;
    for (let i = 0; i < 4; i++) {
      await put(cookie, { collection: coll(i + 1), binders: [], decks: [], baseVersion: v++ });
      await put(cookie, { collection: null, binders: [], decks: [], baseVersion: v++ });
    }
    const list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    expect(list.body.backups).toHaveLength(3);
    // Newest first; the oldest (priorCardCount 1) was pruned.
    const counts = list.body.backups.map((b: { priorCardCount: number }) => b.priorCardCount);
    expect(counts).toEqual([4, 3, 2]);
  });

  it('restores a backup as the current snapshot (version-bumped)', async () => {
    const cookie = await registerAndGetCookie('bk_dave');
    await put(cookie, {
      collection: coll(2),
      binders: [{ id: 'b1' }],
      decks: [{ id: 'd1' }],
      baseVersion: 0,
    });
    await put(cookie, { collection: null, binders: [], decks: [], baseVersion: 1 }); // wipe → v2

    const list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    const backupId = list.body.backups[0].id;

    const restored = await request(app)
      .post('/api/sync/restore')
      .set('Cookie', cookie)
      .send({ backupId, baseVersion: 2 });
    expect(restored.status).toBe(200);
    expect(restored.body.version).toBe(3);
    expect(restored.body.collection.cards).toHaveLength(2);
    expect(restored.body.binders).toEqual([{ id: 'b1' }]);

    const get = await request(app).get('/api/sync').set('Cookie', cookie);
    expect(get.body.collection.cards).toHaveLength(2);
    expect(get.body.version).toBe(3);
  });

  it('rejects a restore with a stale baseVersion (409 + current)', async () => {
    const cookie = await registerAndGetCookie('bk_erin');
    await put(cookie, { collection: coll(1), binders: [], decks: [], baseVersion: 0 });
    await put(cookie, { collection: null, binders: [], decks: [], baseVersion: 1 }); // v2
    const list = await request(app).get('/api/sync/backups').set('Cookie', cookie);
    const conflict = await request(app)
      .post('/api/sync/restore')
      .set('Cookie', cookie)
      .send({ backupId: list.body.backups[0].id, baseVersion: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.current.version).toBe(2);
  });

  it('404s an unknown backup and isolates backups per user', async () => {
    const c1 = await registerAndGetCookie('bk_frank');
    const c2 = await registerAndGetCookie('bk_grace');
    await request(app)
      .put('/api/sync')
      .set('Cookie', c1)
      .send({ collection: coll(2), binders: [], decks: [], baseVersion: 0 });
    await request(app)
      .put('/api/sync')
      .set('Cookie', c1)
      .send({ collection: null, binders: [], decks: [], baseVersion: 1 });
    const list = await request(app).get('/api/sync/backups').set('Cookie', c1);
    const c1BackupId = list.body.backups[0].id;

    // c2 cannot see or restore c1's backup.
    const c2List = await request(app).get('/api/sync/backups').set('Cookie', c2);
    expect(c2List.body.backups).toEqual([]);
    const cross = await request(app)
      .post('/api/sync/restore')
      .set('Cookie', c2)
      .send({ backupId: c1BackupId, baseVersion: 0 });
    expect(cross.status).toBe(404);
  });

  it('validates the restore payload', async () => {
    const cookie = await registerAndGetCookie('bk_heidi');
    const noId = await request(app)
      .post('/api/sync/restore')
      .set('Cookie', cookie)
      .send({ baseVersion: 0 });
    expect(noId.status).toBe(400);
    const noBase = await request(app)
      .post('/api/sync/restore')
      .set('Cookie', cookie)
      .send({ backupId: 'x' });
    expect(noBase.status).toBe(400);
  });

  it('requires auth for backup endpoints', async () => {
    expect((await request(app).get('/api/sync/backups')).status).toBe(401);
    expect((await request(app).post('/api/sync/restore').send({})).status).toBe(401);
  });
});
