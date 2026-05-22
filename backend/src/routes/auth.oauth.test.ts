import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, dbTestsEnabled, extractSessionCookie } from '../test-helpers';

// Stub only the Google network call (`exchangeGoogleCode`); the user-resolution
// and handoff-code helpers stay real so the DB-backed logic is exercised.
const { mockExchange } = vi.hoisted(() => ({ mockExchange: vi.fn() }));
vi.mock('../oauth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oauth/google')>();
  return { ...actual, exchangeGoogleCode: mockExchange };
});

import { signOAuthState } from '../auth';

const d = dbTestsEnabled ? describe : describe.skip;

let app: Express;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_WEB_REDIRECT_URI = 'http://localhost:5173/api/auth/google/callback';
  process.env.OAUTH_NATIVE_REDIRECT_URI = 'http://localhost:3737/api/auth/google/callback';
  if (!dbTestsEnabled) return;
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

beforeEach(() => {
  mockExchange.mockReset();
});

d('GET /api/auth/providers', () => {
  it('reports Google as enabled when configured', async () => {
    const res = await request(app).get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ password: true, google: true });
  });
});

d('GET /api/auth/google', () => {
  it('redirects to the Google consent screen', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });
});

d('GET /api/auth/google/callback', () => {
  it('creates an account and sets a session cookie (web)', async () => {
    mockExchange.mockResolvedValue({
      sub: 'web-sub-1',
      email: 'webuser@example.com',
      emailVerified: true,
      name: 'Web User',
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: signOAuthState('web') });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('does not create a second account on a repeat sign-in', async () => {
    mockExchange.mockResolvedValue({
      sub: 'web-sub-repeat',
      email: 'repeat@example.com',
      emailVerified: true,
      name: null,
    });
    await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'c1', state: signOAuthState('web') });
    await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'c2', state: signOAuthState('web') });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE provider_subject = 'web-sub-repeat'`
    );
    expect(rows[0].n).toBe(1);
  });

  it('deep-links a handoff code back to the native app', async () => {
    mockExchange.mockResolvedValue({
      sub: 'native-sub-1',
      email: 'nativeuser@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: signOAuthState('native') });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^spellcontrol:\/\/oauth\/callback\?code=/);
    // The native flow must NOT set a cookie — the system browser jar is dead-ended.
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeNull();
  });

  it('redirects to an error page when the state is invalid', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: 'not-a-real-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth?error=google');
  });
});

d('POST /api/auth/google/exchange', () => {
  it('trades a handoff code for a session cookie', async () => {
    mockExchange.mockResolvedValue({
      sub: 'native-sub-exchange',
      email: 'exchange@example.com',
      emailVerified: true,
      name: null,
    });
    const callback = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: signOAuthState('native') });
    const code = new URL(callback.headers.location).searchParams.get('code')!;

    const res = await request(app).post('/api/auth/google/exchange').send({ code });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('exchange');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();

    // Single-use — a replay fails.
    const replay = await request(app).post('/api/auth/google/exchange').send({ code });
    expect(replay.status).toBe(401);
  });

  it('rejects an unknown handoff code', async () => {
    const res = await request(app).post('/api/auth/google/exchange').send({ code: 'never-minted' });
    expect(res.status).toBe(401);
  });
});
