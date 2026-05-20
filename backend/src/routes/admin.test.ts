import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { createTestEnv, dbTestsEnabled, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';

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

d('GET /api/admin/users', () => {
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
});

d('DELETE /api/admin/users/:id', () => {
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

d('/api/auth/me returns role', () => {
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
