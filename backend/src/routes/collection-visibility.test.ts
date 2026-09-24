import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';

// Who can see a collection (board T136): the setting, what narrowing it
// revokes, and the ambient friend view honouring Private.

let app: Server;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function makeUser(username: string): Promise<{ cookie: string; id: string }> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, id: me.body.user.id as string };
}

async function befriend(
  a: { cookie: string },
  aName: string,
  b: { cookie: string },
  bName: string
): Promise<void> {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: bName });
  const r = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: aName });
  expect(r.body.friendStatus).toBe('friends');
}

const setVisibility = (cookie: string, visibility: unknown) =>
  request(app)
    .patch('/api/auth/me/collection-visibility')
    .set('Cookie', cookie)
    .send({ visibility });

const liveCollectionShares = async (userId: string) =>
  (
    await pool.query<{ audience: string }>(
      `SELECT audience FROM shares
        WHERE user_id = $1 AND kind = 'collection' AND revoked_at IS NULL ORDER BY audience`,
      [userId]
    )
  ).rows.map((r) => r.audience);

describe('PATCH /api/auth/me/collection-visibility', () => {
  it('sets it, and /me reports it; a new account starts public', async () => {
    const u = await makeUser('cv-set');
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).body).toMatchObject({
      collectionVisibility: 'public',
    });
    const res = await setVisibility(u.cookie, 'friends');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ collectionVisibility: 'friends' });
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).body).toMatchObject({
      collectionVisibility: 'friends',
    });
  });

  it('rejects anything but the three choices, and a guest', async () => {
    const u = await makeUser('cv-bad');
    expect((await setVisibility(u.cookie, 'link')).status).toBe(400);
    expect((await setVisibility(u.cookie, null)).status).toBe(400);
    expect(
      (
        await request(app)
          .patch('/api/auth/me/collection-visibility')
          .send({ visibility: 'public' })
      ).status
    ).toBe(401);
  });

  it('narrowing revokes the older links that would still get past it', async () => {
    const u = await makeUser('cv-narrow');
    const mint = (audience: string) =>
      request(app)
        .post('/api/shares')
        .set('Cookie', u.cookie)
        .send({ kind: 'collection', audience });
    await mint('link');
    await setVisibility(u.cookie, 'public');
    expect(await liveCollectionShares(u.id)).toEqual(['link']);

    await setVisibility(u.cookie, 'friends');
    expect(await liveCollectionShares(u.id)).toEqual([]);

    await mint('friends');
    await setVisibility(u.cookie, 'private');
    expect(await liveCollectionShares(u.id)).toEqual([]);
  });
});

describe('the ambient friend collection honours the choice', () => {
  it('Private hides it from friends too, and says so rather than "empty"', async () => {
    const owner = await makeUser('cv-fr-owner');
    const friend = await makeUser('cv-fr-friend');
    await befriend(owner, 'cv-fr-owner', friend, 'cv-fr-friend');
    await setSnapshotViaSyncApi(request(app), owner.cookie, {
      collection: {
        cards: [
          {
            copyId: 'c1',
            name: 'Sol Ring',
            oracleId: 'o-sol',
            scryfallId: 's1',
            typeLine: 'Artifact',
            importId: 'i1',
          },
        ],
      },
    });

    const open = await request(app)
      .get(`/api/friends/${owner.id}/collection`)
      .set('Cookie', friend.cookie);
    expect(open.body.cards).toHaveLength(1);
    expect(open.body.fullView).toBe(true);

    await setVisibility(owner.cookie, 'private');
    const closed = await request(app)
      .get(`/api/friends/${owner.id}/collection`)
      .set('Cookie', friend.cookie);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ cards: [], collectionPrivate: true, fullView: false });
  });

  it('an account that never chose keeps the card-level view, with no full view', async () => {
    const owner = await makeUser('cv-null-owner');
    const friend = await makeUser('cv-null-friend');
    await befriend(owner, 'cv-null-owner', friend, 'cv-null-friend');
    await pool.query(`UPDATE users SET collection_visibility = NULL WHERE id = $1`, [owner.id]);
    const res = await request(app)
      .get(`/api/friends/${owner.id}/collection`)
      .set('Cookie', friend.cookie);
    expect(res.status).toBe(200);
    expect(res.body.fullView).toBe(false);
    expect(res.body).not.toHaveProperty('collectionPrivate');
  });
});
