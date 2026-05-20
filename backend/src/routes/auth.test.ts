import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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

d('POST /api/auth/register', () => {
  it('creates a user and returns a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'alice' });
    expect(res.body.user.id).toBeTypeOf('string');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('rejects duplicate usernames', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'another good password' });
    expect(res.status).toBe(409);
  });

  it('rejects short passwords', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'cory', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed usernames', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'BadUser!', password: 'correct horse battery' });
    expect(res.status).toBe(400);
  });

  it('lowercases usernames so case-only duplicates collide', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'dan', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'DAN', password: 'correct horse battery' });
    expect(res.status).toBe(409);
  });
});

d('POST /api/auth/register — ALLOWED_USERNAMES allowlist', () => {
  afterEach(() => {
    delete process.env.ALLOWED_USERNAMES;
  });

  it('rejects a username not on the allowlist with 403', async () => {
    process.env.ALLOWED_USERNAMES = 'charlie,david';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'eve', password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invite-only/i);
  });

  it('allows a username on the allowlist', async () => {
    process.env.ALLOWED_USERNAMES = 'charlie,david';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'charlie', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('charlie');
  });

  it('matches case-insensitively and tolerates whitespace', async () => {
    process.env.ALLOWED_USERNAMES = '  Pat , QUINN ';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'quinn', password: 'correct horse battery' });
    expect(res.status).toBe(201);
  });

  it('leaves registration open when the env var is empty', async () => {
    process.env.ALLOWED_USERNAMES = '';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'jamie', password: 'correct horse battery' });
    expect(res.status).toBe(201);
  });
});

d('POST /api/auth/login', () => {
  it('returns a session cookie on valid credentials', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'eve', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'eve', password: 'correct horse battery' });
    expect(res.status).toBe(200);
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('rejects wrong password with generic 401', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'frank', password: 'correct horse battery' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'frank', password: 'wrong wrong wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns the same generic error for unknown users', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'correct horse battery' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

d('GET /api/auth/me', () => {
  it('returns 401 without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the user with a valid session', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'helen', password: 'correct horse battery' });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('helen');
  });
});

d('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    const arr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(arr.some((c: string) => /spellcontrol_session=;/.test(c))).toBe(true);
  });
});

d('DELETE /api/auth/me', () => {
  it('deletes the account and invalidates the session', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'iris', password: 'correct horse battery' });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
    const del = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(del.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });
});
