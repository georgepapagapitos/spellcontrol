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

async function publish(userId: string, slug: string, publishedAt = Date.now()): Promise<void> {
  await pool.query(
    `INSERT INTO deck_publications (user_id, deck_id, slug, deck_name, format, published_at, updated_at)
     VALUES ($1, $2, $2, $2, 'commander', $3, $3)`,
    [userId, slug, publishedAt]
  );
}

describe('POST /api/follows/:username', () => {
  it('requires a session', async () => {
    const target = await makeUser('ftarget');
    const res = await request(app).post(`/api/follows/${target.username}`);
    expect(res.status).toBe(401);
  });

  it('follows, is idempotent, and reports the follower count', async () => {
    const a = await makeUser('fa');
    const b = await makeUser('fb');
    const target = await makeUser('ftarget');
    const first = await request(app)
      .post(`/api/follows/${target.username}`)
      .set('Cookie', a.cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ following: true, followerCount: 1 });
    const again = await request(app)
      .post(`/api/follows/${target.username}`)
      .set('Cookie', a.cookie);
    expect(again.body).toEqual({ following: true, followerCount: 1 });
    const other = await request(app)
      .post(`/api/follows/${target.username}`)
      .set('Cookie', b.cookie);
    expect(other.body.followerCount).toBe(2);
  });

  it('accepts any casing of the username', async () => {
    const a = await makeUser('fcase');
    const target = await makeUser('ftcase');
    const res = await request(app)
      .post(`/api/follows/${target.username.toUpperCase()}`)
      .set('Cookie', a.cookie);
    expect(res.status).toBe(200);
  });

  it('404s an unknown or malformed username', async () => {
    const a = await makeUser('fnf');
    expect(
      (await request(app).post('/api/follows/nobody-here').set('Cookie', a.cookie)).status
    ).toBe(404);
    expect((await request(app).post('/api/follows/%20').set('Cookie', a.cookie)).status).toBe(404);
  });

  it('refuses to follow yourself', async () => {
    const a = await makeUser('fself');
    const res = await request(app).post(`/api/follows/${a.username}`).set('Cookie', a.cookie);
    expect(res.status).toBe(400);
    const { rows } = await pool.query(`SELECT 1 FROM user_follows WHERE follower_id = $1`, [a.id]);
    expect(rows).toHaveLength(0);
  });

  it('404s a moderator-hidden account like an unknown one', async () => {
    const a = await makeUser('fhid');
    const target = await makeUser('fhidt');
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [
      target.id,
      Date.now(),
    ]);
    const res = await request(app).post(`/api/follows/${target.username}`).set('Cookie', a.cookie);
    expect(res.status).toBe(404);
  });

  it('lets anyone follow, friends or not', async () => {
    const a = await makeUser('fany');
    const target = await makeUser('fanyt');
    const res = await request(app).post(`/api/follows/${target.username}`).set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT 1 FROM friendships WHERE requester_id = $1`, [a.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('DELETE /api/follows/:username', () => {
  it('unfollows, idempotently', async () => {
    const a = await makeUser('fu');
    const target = await makeUser('fut');
    await request(app).post(`/api/follows/${target.username}`).set('Cookie', a.cookie);
    const first = await request(app)
      .delete(`/api/follows/${target.username}`)
      .set('Cookie', a.cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ following: false, followerCount: 0 });
    const again = await request(app)
      .delete(`/api/follows/${target.username}`)
      .set('Cookie', a.cookie);
    expect(again.status).toBe(200);
  });

  it('404s an unknown user, and requires a session', async () => {
    const a = await makeUser('fud');
    expect(
      (await request(app).delete('/api/follows/nobody-here').set('Cookie', a.cookie)).status
    ).toBe(404);
    expect((await request(app).delete(`/api/follows/${a.username}`)).status).toBe(401);
  });

  it('still unfollows an account that was hidden after the follow', async () => {
    const a = await makeUser('fuh');
    const target = await makeUser('fuht');
    await request(app).post(`/api/follows/${target.username}`).set('Cookie', a.cookie);
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [
      target.id,
      Date.now(),
    ]);
    const res = await request(app)
      .delete(`/api/follows/${target.username}`)
      .set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT 1 FROM user_follows WHERE follower_id = $1`, [a.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('GET /api/follows/following', () => {
  it('lists followed brewers newest follow first, without hidden accounts', async () => {
    const me = await makeUser('fl');
    const first = await makeUser('flfirst');
    const second = await makeUser('flsecond');
    const hidden = await makeUser('flhidden');
    await publish(second.id, `${second.username}-deck`);
    for (const t of [first, hidden, second]) {
      await request(app).post(`/api/follows/${t.username}`).set('Cookie', me.cookie);
      await pool.query(
        `UPDATE user_follows SET created_at = created_at + $3 WHERE follower_id = $1 AND followee_id = $2`,
        [me.id, t.id, [first, hidden, second].indexOf(t) * 1000]
      );
    }
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [
      hidden.id,
      Date.now(),
    ]);
    const res = await request(app).get('/api/follows/following').set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(res.body.brewers.map((b: { username: string }) => b.username)).toEqual([
      second.username,
      first.username,
    ]);
    // Someone followed who has no decks yet still shows, with a zero count.
    expect(res.body.brewers[1]).toMatchObject({ deckCount: 0, bannerImage: null });
    expect(res.body.brewers[0]).toMatchObject({ deckCount: 1 });
  });

  it('is empty for someone who follows nobody, and needs a session', async () => {
    const me = await makeUser('fle');
    const res = await request(app).get('/api/follows/following').set('Cookie', me.cookie);
    expect(res.body).toEqual({ brewers: [] });
    expect((await request(app).get('/api/follows/following')).status).toBe(401);
  });
});

describe('account deletion', () => {
  it('drops follows in both directions', async () => {
    const a = await makeUser('fdel');
    const b = await makeUser('fdelb');
    await request(app).post(`/api/follows/${b.username}`).set('Cookie', a.cookie);
    await pool.query(`DELETE FROM users WHERE id = $1`, [a.id]);
    const { rows } = await pool.query(`SELECT 1 FROM user_follows WHERE followee_id = $1`, [b.id]);
    expect(rows).toHaveLength(0);
  });

  it('cannot store a self-follow at the database level', async () => {
    const a = await makeUser('fchk');
    await expect(
      pool.query(`INSERT INTO user_follows VALUES ($1, $1, $2)`, [a.id, Date.now()])
    ).rejects.toThrow();
  });
});
