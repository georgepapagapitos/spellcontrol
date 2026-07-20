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

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

describe('GET /api/users/search', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).get('/api/users/search?q=test');
    expect(res.status).toBe(401);
  });

  it('returns 400 when q is empty', async () => {
    const alice = await makeUser('search-empty-alice');
    const res = await request(app).get('/api/users/search?q=').set('Cookie', alice);
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is missing', async () => {
    const alice = await makeUser('search-missing-alice');
    const res = await request(app).get('/api/users/search').set('Cookie', alice);
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is longer than 32 chars', async () => {
    const alice = await makeUser('search-long-alice');
    const q = 'a'.repeat(33);
    const res = await request(app).get(`/api/users/search?q=${q}`).set('Cookie', alice);
    expect(res.status).toBe(400);
  });

  it('finds users by prefix', async () => {
    const alice = await makeUser('search-prefix-alice');
    await makeUser('search-prefix-bob');
    await makeUser('search-prefix-carol');

    const res = await request(app).get('/api/users/search?q=search-prefix-b').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].username).toBe('search-prefix-bob');
    expect(res.body.users[0].displayName).toBeNull();
  });

  it('returns a matched user’s display name when set', async () => {
    const alice = await makeUser('search-dname-alice');
    const bob = await makeUser('search-dname-bob');
    await request(app).patch('/api/auth/profile').set('Cookie', bob).send({ displayName: 'Bobby' });

    const res = await request(app).get('/api/users/search?q=search-dname-b').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.users[0].displayName).toBe('Bobby');
  });

  it('excludes the caller from results', async () => {
    const alice = await makeUser('search-self-excl');
    const res = await request(app).get('/api/users/search?q=search-self-excl').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(
      res.body.users.every((u: { username: string }) => u.username !== 'search-self-excl')
    ).toBe(true);
  });

  it('returns exact match first, then alpha order', async () => {
    const searcher = await makeUser('search-order-searcher');
    await makeUser('search-order-abc');
    await makeUser('search-order');

    const res = await request(app).get('/api/users/search?q=search-order').set('Cookie', searcher);
    expect(res.status).toBe(200);
    const names = res.body.users.map((u: { username: string }) => u.username);
    expect(names[0]).toBe('search-order'); // exact first
    expect(names[1]).toBe('search-order-abc');
  });

  it('caps results at 10', async () => {
    const base = await makeUser('search-cap-base');
    for (let i = 0; i < 12; i++) {
      await makeUser(`search-cap-u${i.toString().padStart(2, '0')}`);
    }

    const res = await request(app).get('/api/users/search?q=search-cap-u').set('Cookie', base);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeLessThanOrEqual(10);
  }, 15000); // 13 bcrypt registers; slow under coverage instrumentation

  it('returns friendStatus=none for strangers', async () => {
    const alice = await makeUser('search-status-none-a');
    await makeUser('search-status-none-b');

    const res = await request(app)
      .get('/api/users/search?q=search-status-none-b')
      .set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.users[0].friendStatus).toBe('none');
  });

  it('returns friendStatus=request_sent after sending a request', async () => {
    const alice = await makeUser('search-sent-a');
    await makeUser('search-sent-b');

    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'search-sent-b' });

    const res = await request(app).get('/api/users/search?q=search-sent-b').set('Cookie', alice);
    expect(res.body.users[0].friendStatus).toBe('request_sent');
  });

  it('returns friendStatus=request_received when the other user sent to you', async () => {
    const alice = await makeUser('search-recv-a');
    const bob = await makeUser('search-recv-b');

    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', bob)
      .send({ username: 'search-recv-a' });

    const res = await request(app).get('/api/users/search?q=search-recv-b').set('Cookie', alice);
    expect(res.body.users[0].friendStatus).toBe('request_received');
  });

  it('returns friendStatus=friends when accepted', async () => {
    const alice = await makeUser('search-friends-a');
    const bob = await makeUser('search-friends-b');

    // Alice → Bob
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'search-friends-b' });
    // Bob → Alice (auto-accept)
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', bob)
      .send({ username: 'search-friends-a' });

    const res = await request(app).get('/api/users/search?q=search-friends-b').set('Cookie', alice);
    expect(res.body.users[0].friendStatus).toBe('friends');
  });
});
