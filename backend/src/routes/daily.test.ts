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

let seq = 0;
async function makeUser(prefix: string): Promise<{ cookie: string; username: string; id: string }> {
  seq += 1;
  const username = `${prefix}-${seq}`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, username, id: me.body.user.id as string };
}

async function makeFriends(aId: string, bId: string, status = 'accepted'): Promise<void> {
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at, accepted_at)
     VALUES ($1, $2, $3, 1, 2)`,
    [aId, bId, status]
  );
}

async function put(
  userId: string,
  date: string,
  solved: boolean,
  guesses = solved ? 3 : 6
): Promise<void> {
  await pool.query(
    `INSERT INTO daily_results (user_id, puzzle_date, solved, guesses, created_at)
     VALUES ($1, $2, $3, $4, 1)`,
    [userId, date, solved, guesses]
  );
}

const post = (cookie: string, body: unknown) =>
  request(app)
    .post('/api/daily/results')
    .set('Cookie', cookie)
    .send(body as object);

describe('signed out', () => {
  it('401s on all three routes', async () => {
    expect((await request(app).post('/api/daily/results').send({ results: [] })).status).toBe(401);
    expect((await request(app).get('/api/daily/me')).status).toBe(401);
    expect((await request(app).get('/api/daily/friends?date=2026-05-10')).status).toBe(401);
  });
});

describe('POST /api/daily/results', () => {
  const ok = { date: '2026-05-10', solved: true, guesses: 3 };

  it('rejects invalid bodies and writes nothing', async () => {
    const u = await makeUser('dv');
    const tomorrowPlus = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const cases: unknown[] = [
      {},
      { results: [] },
      { results: 'x' },
      { results: Array.from({ length: 401 }, () => ok) },
      { results: [{ ...ok, date: '2026-5-10' }] },
      { results: [{ ...ok, date: '2026-02-30' }] },
      { results: [{ ...ok, date: tomorrowPlus }] },
      { results: [{ ...ok, date: '2025-12-31' }] },
      { results: [{ ...ok, guesses: 0 }] },
      { results: [{ ...ok, guesses: 7 }] },
      { results: [{ ...ok, guesses: 2.5 }] },
      { results: [{ ...ok, guesses: '3' }] },
      { results: [{ ...ok, solved: 'yes' }] },
      { results: [{ ...ok, solved: false, guesses: 4 }] },
      { results: [null] },
      // One good entry beside a bad one: nothing is written.
      { results: [ok, { ...ok, date: '2026-05-11', guesses: 9 }] },
    ];
    for (const body of cases) {
      const res = await post(u.cookie, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
    const { rows } = await pool.query(`SELECT 1 FROM daily_results WHERE user_id = $1`, [u.id]);
    expect(rows).toHaveLength(0);
  });

  it('accepts today and tomorrow (clock skew) and a failed puzzle at 6', async () => {
    const u = await makeUser('dt');
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await post(u.cookie, {
      results: [
        { date: today, solved: true, guesses: 1 },
        { date: tomorrow, solved: false, guesses: 6 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: 2 });
  });

  it('keeps the first result for a day; a replay cannot overwrite it', async () => {
    const u = await makeUser('dr');
    const first = await post(u.cookie, { results: [ok, { ...ok, date: '2026-05-11' }] });
    expect(first.body).toEqual({ saved: 2 });
    const replay = await post(u.cookie, {
      results: [
        { date: '2026-05-10', solved: false, guesses: 6 },
        { date: '2026-05-12', solved: true, guesses: 2 },
      ],
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ saved: 1 });
    const me = await request(app).get('/api/daily/me').set('Cookie', u.cookie);
    expect(me.body.results).toContainEqual(ok);
    expect(me.body.results).not.toContainEqual({ date: '2026-05-10', solved: false, guesses: 6 });
  });

  it('keeps the first of a duplicate date inside one batch', async () => {
    const u = await makeUser('dd');
    const res = await post(u.cookie, {
      results: [ok, { date: ok.date, solved: false, guesses: 6 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
  });
});

describe('GET /api/daily/me', () => {
  it('lists own results newest first', async () => {
    const u = await makeUser('dm');
    const other = await makeUser('dmo');
    await put(other.id, '2026-05-20', true);
    await post(u.cookie, {
      results: [
        { date: '2026-05-09', solved: true, guesses: 4 },
        { date: '2026-05-11', solved: false, guesses: 6 },
        { date: '2026-05-10', solved: true, guesses: 1 },
      ],
    });
    const res = await request(app).get('/api/daily/me').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { date: '2026-05-11', solved: false, guesses: 6 },
      { date: '2026-05-10', solved: true, guesses: 1 },
      { date: '2026-05-09', solved: true, guesses: 4 },
    ]);
  });

  it('is empty for a new account', async () => {
    const u = await makeUser('dme');
    const res = await request(app).get('/api/daily/me').set('Cookie', u.cookie);
    expect(res.body).toEqual({ results: [] });
  });
});

describe('GET /api/daily/friends', () => {
  const D = '2026-05-10';
  const get = (cookie: string, q = `?date=${D}`) =>
    request(app).get(`/api/daily/friends${q}`).set('Cookie', cookie);

  it('requires a valid date', async () => {
    const u = await makeUser('dfv');
    expect((await get(u.cookie, '')).status).toBe(400);
    expect((await get(u.cookie, '?date=nope')).status).toBe(400);
    expect((await get(u.cookie, '?date=2026-13-01')).status).toBe(400);
  });

  it('is empty without friends', async () => {
    const u = await makeUser('dfe');
    const res = await get(u.cookie);
    expect(res.body).toEqual({ friends: [] });
  });

  it('returns only accepted friends, sorted, with null for not-played', async () => {
    const me = await makeUser('dfm');
    const stranger = await makeUser('dfs');
    const pending = await makeUser('dfp');
    const slow = await makeUser('dfa');
    const fast = await makeUser('dfb');
    const failed = await makeUser('dfc');
    const idleB = await makeUser('dfz');
    const idleA = await makeUser('dfy');
    await makeFriends(me.id, slow.id);
    await makeFriends(fast.id, me.id); // other direction
    await makeFriends(me.id, failed.id);
    await makeFriends(me.id, idleB.id);
    await makeFriends(me.id, idleA.id);
    await makeFriends(me.id, pending.id, 'pending');
    await put(stranger.id, D, true, 1);
    await put(pending.id, D, true, 1);
    await put(me.id, D, true, 1);
    await put(slow.id, D, true, 5);
    await put(fast.id, D, true, 2);
    await put(failed.id, D, false);

    const res = await get(me.cookie);
    expect(res.status).toBe(200);
    const names = res.body.friends.map((f: { username: string }) => f.username);
    expect(names).toEqual([
      fast.username,
      slow.username,
      failed.username,
      // Not played: ties by username.
      idleA.username < idleB.username ? idleA.username : idleB.username,
      idleA.username < idleB.username ? idleB.username : idleA.username,
    ]);
    const first = res.body.friends[0];
    expect(first).toMatchObject({
      userId: fast.id,
      displayName: null,
      avatarImageUrl: null,
      result: { solved: true, guesses: 2 },
      streak: 1,
    });
    expect(res.body.friends[2]).toMatchObject({ result: { solved: false, guesses: 6 }, streak: 0 });
    expect(res.body.friends[3].result).toBeNull();
  });

  it('computes streaks: today and yesterday, unplayed today, failed day, gap', async () => {
    const me = await makeUser('dsm');
    const twoDays = await makeUser('dsa');
    const carry = await makeUser('dsb');
    const broken = await makeUser('dsc');
    const gap = await makeUser('dsd');
    for (const f of [twoDays, carry, broken, gap]) await makeFriends(me.id, f.id);
    await put(twoDays.id, '2026-05-10', true);
    await put(twoDays.id, '2026-05-09', true);
    await put(carry.id, '2026-05-09', true);
    await put(carry.id, '2026-05-08', true);
    await put(broken.id, '2026-05-10', true);
    await put(broken.id, '2026-05-09', false);
    await put(broken.id, '2026-05-08', true);
    await put(gap.id, '2026-05-10', true);
    await put(gap.id, '2026-05-08', true);

    const res = await get(me.cookie);
    const streak = (u: { id: string }) =>
      res.body.friends.find((f: { userId: string }) => f.userId === u.id).streak;
    expect(streak(twoDays)).toBe(2);
    expect(streak(carry)).toBe(2);
    expect(streak(broken)).toBe(1);
    expect(streak(gap)).toBe(1);
    const carryRow = res.body.friends.find((f: { userId: string }) => f.userId === carry.id);
    expect(carryRow.result).toBeNull();
  });
});
