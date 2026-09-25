import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { listFriendIds } from './relations';

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
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  const cookie = extractSessionCookie(res.headers['set-cookie'])!;
  const row = await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [
    username,
  ]);
  return { cookie, id: row.rows[0].id };
}

/** Mutual friend request, the same auto-accept path every other suite uses. */
async function befriend(
  a: { cookie: string },
  usernameA: string,
  b: { cookie: string },
  usernameB: string
): Promise<void> {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: usernameB });
  const res = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: usernameA });
  expect(res.status).toBe(201);
}

describe('listFriendIds', () => {
  it('lists an accepted friend from either direction, and excludes a pending request', async () => {
    const alice = await makeUser('relations_alice');
    const bob = await makeUser('relations_bob');
    const carol = await makeUser('relations_carol');

    await befriend(alice, 'relations_alice', bob, 'relations_bob');
    // Carol asks alice but alice never accepts — stays pending, not a friend.
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', carol.cookie)
      .send({ username: 'relations_alice' });

    const aliceFriends = await listFriendIds(alice.id);
    expect(aliceFriends).toEqual([bob.id]);

    // Symmetric: bob sees alice too, even though alice was the requester.
    expect(await listFriendIds(bob.id)).toEqual([alice.id]);
  });

  it('returns empty for a user with no accepted friends', async () => {
    const solo = await makeUser('relations_solo');
    expect(await listFriendIds(solo.id)).toEqual([]);
  });
});
