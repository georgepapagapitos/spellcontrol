import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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

async function makeUser(username: string) {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status, `register(${username}) → ${JSON.stringify(reg.body)}`).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const row = await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [
    username,
  ]);
  return { cookie, id: row.rows[0].id, username };
}

async function befriend(a: { cookie: string; username: string }, b: typeof a) {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: b.username });
  const res = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: a.username });
  expect(res.body.friendStatus).toBe('friends');
}

async function seedCopies(userId: string, ids: string[], oracleId = 'sol-oracle') {
  for (const id of ids) {
    await pool.query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
       VALUES ($1, $2, 'import-1', $3, nextval('user_data_rev_seq'), $4)`,
      [userId, id, JSON.stringify({ name: 'Sol Ring', oracleId, typeLine: 'Artifact' }), Date.now()]
    );
  }
}

const owners = (cookie: string, q = 'oracleId=sol-oracle') =>
  request(app).get(`/api/friends/owners?${q}`).set('Cookie', cookie);

describe('GET /api/friends/owners', () => {
  it('401 without a session', async () => {
    expect((await request(app).get('/api/friends/owners?oracleId=x')).status).toBe(401);
  });

  it('400 when oracleId is missing or malformed', async () => {
    const me = await makeUser('own-val');
    expect((await owners(me.cookie, '')).status).toBe(400);
    expect((await owners(me.cookie, 'oracleId=a%20b;drop')).status).toBe(400);
    expect((await owners(me.cookie, `oracleId=${'x'.repeat(65)}`)).status).toBe(400);
  }, 15000);

  it('is empty when nobody owns the card', async () => {
    const me = await makeUser('own-none');
    const friend = await makeUser('own-none-f');
    await befriend(me, friend);
    const res = await owners(me.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ owners: [] });
  }, 15000);

  it('lists friends only, with the exact key set and no deck or price data', async () => {
    const me = await makeUser('own-main');
    const friend = await makeUser('own-main-f');
    const stranger = await makeUser('own-main-s');
    await befriend(me, friend);
    await seedCopies(friend.id, ['f1', 'f2', 'f3']);
    await seedCopies(stranger.id, ['s1']);
    await seedCopies(me.id, ['m1']);
    // One copy sleeved in a (private) deck: still counted, never named.
    await pool.query(
      `INSERT INTO user_decks (user_id, id, data, rev, updated_at)
       VALUES ($1, 'secret-deck', $2, nextval('user_data_rev_seq'), $3)`,
      [
        friend.id,
        JSON.stringify({
          id: 'secret-deck',
          name: 'Hidden Plans',
          cards: [{ allocatedCopyId: 'f1' }],
        }),
        Date.now(),
      ]
    );
    const res = await owners(me.cookie);
    expect(res.status).toBe(200);
    expect(res.body.owners).toHaveLength(1);
    const row = res.body.owners[0];
    expect(Object.keys(row).sort()).toEqual([
      'count',
      'displayName',
      'friendId',
      'spare',
      'username',
    ]);
    expect(row).toMatchObject({
      friendId: friend.id,
      username: friend.username,
      count: 3,
      spare: true,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret-deck');
    expect(text).not.toContain('Hidden Plans');
  }, 20000);

  it('spare is false when the only copy is claimed by a deck', async () => {
    const me = await makeUser('own-claim');
    const friend = await makeUser('own-claim-f');
    await befriend(me, friend);
    await seedCopies(friend.id, ['c1']);
    await pool.query(
      `INSERT INTO user_decks (user_id, id, data, rev, updated_at)
       VALUES ($1, 'd1', $2, nextval('user_data_rev_seq'), $3)`,
      [friend.id, JSON.stringify({ id: 'd1', cards: [{ allocatedCopyId: 'c1' }] }), Date.now()]
    );
    const res = await owners(me.cookie);
    expect(res.body.owners).toEqual([
      expect.objectContaining({ friendId: friend.id, count: 1, spare: false }),
    ]);
  }, 15000);

  it('skips a friend whose collection is private, and reads NULL as friends', async () => {
    const me = await makeUser('own-priv');
    const hidden = await makeUser('own-priv-h');
    const open = await makeUser('own-priv-o');
    await befriend(me, hidden);
    await befriend(me, open);
    await seedCopies(hidden.id, ['h1', 'h2']);
    await seedCopies(open.id, ['o1', 'o2']);
    await pool.query(`UPDATE users SET collection_visibility = 'private' WHERE id = $1`, [
      hidden.id,
    ]);
    await pool.query(`UPDATE users SET collection_visibility = NULL WHERE id = $1`, [open.id]);
    const res = await owners(me.cookie);
    expect(res.body.owners.map((o: { friendId: string }) => o.friendId)).toEqual([open.id]);
  }, 20000);
});
