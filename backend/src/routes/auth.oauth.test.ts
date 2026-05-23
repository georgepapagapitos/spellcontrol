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

/** Run the Google callback for a given identity and return the 302 response. */
function callback(sub: string, email: string, platform: 'web' | 'native' = 'web') {
  mockExchange.mockResolvedValue({ sub, email, emailVerified: true, name: null });
  return request(app)
    .get('/api/auth/google/callback')
    .query({ code: 'auth-code', state: signOAuthState(platform) });
}

/** Pull the signup token out of a first-time callback redirect (web hash). */
function signupTokenFromWeb(location: string): string {
  const hash = new URL(location, 'http://x').hash.slice(1);
  return new URLSearchParams(hash).get('token')!;
}

/** Drive a first-time sign-in all the way through to a created account. */
async function createGoogleAccount(sub: string, email: string, username: string) {
  const cb = await callback(sub, email, 'web');
  const token = signupTokenFromWeb(cb.headers.location);
  return request(app)
    .post('/api/auth/google/complete-signup')
    .send({ signupToken: token, username });
}

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

d('GET /api/auth/google/callback — first-time sign-in', () => {
  it('sends a new web user to the choose-username screen, creating no account', async () => {
    const res = await callback('new-web-sub', 'newweb@example.com', 'web');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/choose-username#/);
    expect(signupTokenFromWeb(res.headers.location)).toBeTruthy();
    // No session yet — the account does not exist until a username is chosen.
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeNull();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE provider_subject = 'new-web-sub'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('deep-links a signup token to a new native user', async () => {
    const res = await callback('new-native-sub', 'newnative@example.com', 'native');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^spellcontrol:\/\/oauth\/callback\?signup=/);
  });

  it('redirects to an error page when the state is invalid', async () => {
    mockExchange.mockResolvedValue({
      sub: 's',
      email: 'e@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: 'not-a-real-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth?error=google');
  });
});

d('POST /api/auth/google/complete-signup', () => {
  it('creates the account with the chosen username and sets a session', async () => {
    const res = await createGoogleAccount('signup-sub', 'signup@example.com', 'picked-name');
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('picked-name');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('rejects a username that is already taken', async () => {
    await createGoogleAccount('taken-sub-1', 'taken1@example.com', 'duplicate-name');
    const cb = await callback('taken-sub-2', 'taken2@example.com', 'web');
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken: signupTokenFromWeb(cb.headers.location), username: 'duplicate-name' });
    expect(res.status).toBe(409);
  });

  it('rejects a malformed username', async () => {
    const cb = await callback('badname-sub', 'badname@example.com', 'web');
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken: signupTokenFromWeb(cb.headers.location), username: 'No Spaces!' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid signup token', async () => {
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken: 'not-a-token', username: 'whoever' });
    expect(res.status).toBe(401);
  });
});

d('GET /api/auth/google/callback — returning user', () => {
  it('signs a returning web user straight in', async () => {
    await createGoogleAccount('return-web-sub', 'returnweb@example.com', 'return-web');
    const res = await callback('return-web-sub', 'returnweb@example.com', 'web');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();
  });

  it('deep-links a handoff code to a returning native user, and exchange works', async () => {
    await createGoogleAccount('return-native-sub', 'returnnative@example.com', 'return-native');
    const cb = await callback('return-native-sub', 'returnnative@example.com', 'native');
    expect(cb.headers.location).toMatch(/^spellcontrol:\/\/oauth\/callback\?code=/);
    const handoff = new URL(cb.headers.location).searchParams.get('code')!;

    const res = await request(app).post('/api/auth/google/exchange').send({ code: handoff });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('return-native');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();

    // Single-use — a replay fails.
    const replay = await request(app).post('/api/auth/google/exchange').send({ code: handoff });
    expect(replay.status).toBe(401);
  });

  it('does not create a duplicate account on repeat sign-in', async () => {
    await createGoogleAccount('once-sub', 'once@example.com', 'once-only');
    await callback('once-sub', 'once@example.com', 'web');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE provider_subject = 'once-sub'`
    );
    expect(rows[0].n).toBe(1);
  });
});

d('POST /api/auth/google/link-with-password', () => {
  /** Register a password-only account; returns the username. */
  async function registerPassword(username: string, password = 'correct horse battery') {
    const res = await request(app).post('/api/auth/register').send({ username, password });
    expect(res.status).toBe(201);
    return username;
  }

  /** Drive a Google callback for a fresh identity and return its signup token. */
  async function freshSignupToken(sub: string) {
    const cb = await callback(sub, `${sub}@example.com`, 'web');
    return signupTokenFromWeb(cb.headers.location);
  }

  it('links a Google identity to a password account on a valid password', async () => {
    await registerPassword('link-alice', 'correct horse battery');
    const token = await freshSignupToken('link-alice-sub');
    const res = await request(app)
      .post('/api/auth/google/link-with-password')
      .send({ signupToken: token, username: 'link-alice', password: 'correct horse battery' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('link-alice');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();

    const { rows } = await pool.query(
      `SELECT user_id FROM auth_identities WHERE provider_subject = 'link-alice-sub'`
    );
    expect(rows.length).toBe(1);
    // After linking, a follow-up Google callback for the same sub signs the
    // user straight in to the *existing* account (no second account created).
    const cb2 = await callback('link-alice-sub', 'link-alice-sub@example.com', 'web');
    expect(cb2.headers.location).toBe('/');
  });

  it('rejects a wrong password with a generic 401', async () => {
    await registerPassword('link-bob', 'correct horse battery');
    const token = await freshSignupToken('link-bob-sub');
    const res = await request(app)
      .post('/api/auth/google/link-with-password')
      .send({ signupToken: token, username: 'link-bob', password: 'wrong wrong wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns the same generic 401 for an unknown username', async () => {
    const token = await freshSignupToken('link-ghost-sub');
    const res = await request(app)
      .post('/api/auth/google/link-with-password')
      .send({ signupToken: token, username: 'no-such-user', password: 'correct horse battery' });
    expect(res.status).toBe(401);
  });

  it('refuses to add a second Google link to an already-linked account', async () => {
    await registerPassword('link-twice', 'correct horse battery');
    const t1 = await freshSignupToken('link-twice-sub-1');
    await request(app)
      .post('/api/auth/google/link-with-password')
      .send({ signupToken: t1, username: 'link-twice', password: 'correct horse battery' });
    const t2 = await freshSignupToken('link-twice-sub-2');
    const res = await request(app)
      .post('/api/auth/google/link-with-password')
      .send({ signupToken: t2, username: 'link-twice', password: 'correct horse battery' });
    expect(res.status).toBe(409);
  });

  it('rejects an expired or invalid signup token', async () => {
    await registerPassword('link-stale', 'correct horse battery');
    const res = await request(app).post('/api/auth/google/link-with-password').send({
      signupToken: 'not-a-real-token',
      username: 'link-stale',
      password: 'correct horse battery',
    });
    expect(res.status).toBe(401);
  });
});

d('POST /api/auth/google/exchange', () => {
  it('rejects an unknown handoff code', async () => {
    const res = await request(app).post('/api/auth/google/exchange').send({ code: 'never-minted' });
    expect(res.status).toBe(401);
  });
});
