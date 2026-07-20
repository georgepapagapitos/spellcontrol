import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';

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

/** Register a user, then promote them via direct DB write. */
async function registerAdmin(
  username: string,
  password = 'correct horse battery'
): Promise<string> {
  const reg = await request(app).post('/api/auth/register').send({ username, password });
  if (reg.status !== 201) throw new Error(`register admin failed: ${reg.status}`);
  await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = ${username}`);
  // Re-login so the new session cookie carries role='admin' in its JWT claims.
  const login = await request(app).post('/api/auth/login').send({ username, password });
  return extractSessionCookie(login.headers['set-cookie'])!;
}

async function registerUser(username: string, password = 'correct horse battery'): Promise<string> {
  const reg = await request(app).post('/api/auth/register').send({ username, password });
  if (reg.status !== 201) throw new Error(`register user failed: ${reg.status}`);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

describe('GET /api/admin/users', () => {
  it('401s without a session', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('lia');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('returns the user list for an admin', async () => {
    const cookie = await registerAdmin('mara');
    await registerUser('nick');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const usernames = res.body.users.map((u: { username: string }) => u.username);
    expect(usernames).toContain('mara');
    expect(usernames).toContain('nick');
    // Role-aware projection: admin's role comes back as admin, others as user.
    const mara = res.body.users.find((u: { username: string }) => u.username === 'mara');
    const nick = res.body.users.find((u: { username: string }) => u.username === 'nick');
    expect(mara.role).toBe('admin');
    expect(nick.role).toBe('user');
    expect(typeof mara.dataBytes).toBe('number');
  });

  it('surfaces profile fields — null by default, populated after a profile PATCH', async () => {
    const cookie = await registerAdmin('opal');
    const targetCookie = await registerUser('petra');
    let res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    let petra = res.body.users.find((u: { username: string }) => u.username === 'petra');
    expect(petra.displayName).toBeNull();
    expect(petra.bio).toBeNull();
    expect(petra.avatarCardName).toBeNull();

    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', targetCookie)
      .send({
        displayName: 'Petra',
        bio: 'Cube drafter',
        avatar: {
          cardId: '56ebc372-aabd-4174-a943-c7bf59e5049f',
          cardName: 'Sol Ring',
          imageUrl:
            'https://cards.scryfall.io/art_crop/front/5/6/56ebc372-aabd-4174-a943-c7bf59e5049f.jpg',
        },
      });

    res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    petra = res.body.users.find((u: { username: string }) => u.username === 'petra');
    expect(petra.displayName).toBe('Petra');
    expect(petra.bio).toBe('Cube drafter');
    expect(petra.avatarCardName).toBe('Sol Ring');
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('owen');
    const res = await request(app).delete('/api/admin/users/some-id').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('refuses to delete the admin themselves', async () => {
    const cookie = await registerAdmin('pria');
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    const myId = me.body.user.id;
    const res = await request(app).delete(`/api/admin/users/${myId}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it('404s for an unknown user id', async () => {
    const cookie = await registerAdmin('quinn');
    const res = await request(app).delete('/api/admin/users/does-not-exist').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('deletes a target user and their user_data', async () => {
    const adminCookie = await registerAdmin('riya');
    const victimCookie = await registerUser('sam');
    const me = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    const victimId = me.body.user.id;

    const del = await request(app)
      .delete(`/api/admin/users/${victimId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(200);

    // Victim's session should no longer load a user (account is gone).
    const victimMe = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    expect(victimMe.status).toBe(401);
  });
});

describe('POST /api/admin/users/:id/clear-profile', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('ravi');
    const res = await request(app)
      .post('/api/admin/users/some-id/clear-profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('404s for an unknown user id', async () => {
    const cookie = await registerAdmin('sana');
    const res = await request(app)
      .post('/api/admin/users/does-not-exist/clear-profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('clears a set profile', async () => {
    const adminCookie = await registerAdmin('tomas');
    const victimCookie = await registerUser('uma');
    const me = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    const victimId = me.body.user.id;

    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', victimCookie)
      .send({
        displayName: 'Uma',
        bio: 'Playgroup regular',
        avatar: {
          cardId: '56ebc372-aabd-4174-a943-c7bf59e5049f',
          cardName: 'Sol Ring',
          imageUrl:
            'https://cards.scryfall.io/art_crop/front/5/6/56ebc372-aabd-4174-a943-c7bf59e5049f.jpg',
        },
      });

    const res = await request(app)
      .post(`/api/admin/users/${victimId}/clear-profile`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify ALL 5 profile columns were nulled, not just the 3 the admin
    // list surfaces — read back through the victim's own /me.
    const victimMe = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    expect(victimMe.body.profile).toEqual({
      displayName: null,
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    });
  });
});

describe('/api/auth/me returns role', () => {
  it('reflects a promotion done after the JWT was issued', async () => {
    const cookie = await registerUser('tess');
    // Pre-promotion: role=user.
    let me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user.role).toBe('user');
    // Promote in-place; cookie still carries old role, but /auth/me reads DB.
    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = 'tess'`);
    me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user.role).toBe('admin');
  });
});
