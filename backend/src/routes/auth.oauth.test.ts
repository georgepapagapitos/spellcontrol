import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

// Stub only the Google network call (`exchangeGoogleCode`); the user-resolution
// and handoff-code helpers stay real so the DB-backed logic is exercised.
const { mockExchange } = vi.hoisted(() => ({ mockExchange: vi.fn() }));
vi.mock('../oauth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oauth/google')>();
  return { ...actual, exchangeGoogleCode: mockExchange };
});

import { signOAuthState } from '../auth';

let app: Express;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_WEB_REDIRECT_URI = 'http://localhost:5173/api/auth/google/callback';
  process.env.OAUTH_NATIVE_REDIRECT_URI = 'http://localhost:3737/api/auth/google/callback';
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
    .query({ code: 'auth-code', state: signOAuthState({ platform }) });
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

/** Register a password account and return its session cookie + user id. */
async function registerWithSession(username: string, password = 'correct horse battery') {
  const res = await request(app).post('/api/auth/register').send({ username, password });
  expect(res.status).toBe(201);
  return {
    cookie: extractSessionCookie(res.headers['set-cookie'])!,
    userId: res.body.user.id as string,
  };
}

describe('GET /api/auth/providers', () => {
  it('reports Google as enabled when configured', async () => {
    const res = await request(app).get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ password: true, google: true });
  });
});

describe('GET /api/auth/google', () => {
  it('redirects to the Google consent screen', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });
});

describe('GET /api/auth/google/callback — first-time sign-in', () => {
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
    expect(res.headers.location).toMatch(/^https:\/\/spellcontrol\.com\/oauth\/callback\?signup=/);
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

describe('POST /api/auth/google/complete-signup', () => {
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

describe('GET /api/auth/google/callback — returning user', () => {
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
    expect(cb.headers.location).toMatch(/^https:\/\/spellcontrol\.com\/oauth\/callback\?code=/);
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

describe('POST /api/auth/google/link-with-password', () => {
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

describe('POST /api/auth/google/exchange', () => {
  it('rejects an unknown handoff code', async () => {
    const res = await request(app).post('/api/auth/google/exchange').send({ code: 'never-minted' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me/identities', () => {
  it('reports password=true and google=null for a fresh password account', async () => {
    const { cookie } = await registerWithSession('ident-alice');
    const res = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ password: true, google: null });
  });

  it('returns the linked-at timestamp when Google is linked', async () => {
    const { cookie, userId } = await registerWithSession('ident-bob');
    mockExchange.mockResolvedValue({
      sub: 'ident-bob-sub',
      email: 'identbob@example.com',
      emailVerified: true,
      name: null,
    });
    await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    const res = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    expect(res.body.google?.linkedAt).toBeTypeOf('number');
  });

  it('401s without a session', async () => {
    const res = await request(app).get('/api/auth/me/identities');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/google/link', () => {
  it('redirects an authed web user to the Google consent screen', async () => {
    const { cookie } = await registerWithSession('linkstart-alice');
    const res = await request(app).get('/api/auth/google/link').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('sends a web user with no session to /auth', async () => {
    const res = await request(app).get('/api/auth/google/link');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth');
  });

  it('401s for native without an intent token', async () => {
    const res = await request(app).get('/api/auth/google/link').query({ platform: 'native' });
    expect(res.status).toBe(401);
  });

  it('accepts a valid intent token for the native flow', async () => {
    const { cookie } = await registerWithSession('linkstart-native');
    const intentRes = await request(app).post('/api/auth/google/link-intent').set('Cookie', cookie);
    expect(intentRes.status).toBe(200);
    const intent = intentRes.body.intent;
    const res = await request(app)
      .get('/api/auth/google/link')
      .query({ platform: 'native', intent });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });
});

describe('GET /api/auth/google/callback — link mode', () => {
  it('attaches a Google identity to the authed user (web)', async () => {
    const { userId } = await registerWithSession('linkcb-alice');
    mockExchange.mockResolvedValue({
      sub: 'linkcb-alice-sub',
      email: 'linkcb-alice@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'auth-code',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?linked=google');
    // No cookie is set/cleared — the user was already authed via their existing session.
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeNull();
    const { rows } = await pool.query(
      `SELECT user_id FROM auth_identities WHERE provider_subject = 'linkcb-alice-sub'`
    );
    expect(rows[0].user_id).toBe(userId);
  });

  it('refuses when the Google account is already linked to a different user', async () => {
    const { userId } = await registerWithSession('linkcb-bob');
    await createGoogleAccount('linkcb-shared-sub', 'shared@example.com', 'shared-google');
    mockExchange.mockResolvedValue({
      sub: 'linkcb-shared-sub',
      email: 'shared@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'auth-code',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    expect(res.headers.location).toBe('/settings?linkError=already_linked');
  });

  it('refuses when the authed user already has a Google account linked', async () => {
    const { userId } = await registerWithSession('linkcb-cara');
    mockExchange.mockResolvedValue({
      sub: 'linkcb-cara-1',
      email: 'cara1@example.com',
      emailVerified: true,
      name: null,
    });
    await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c1',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    mockExchange.mockResolvedValue({
      sub: 'linkcb-cara-2',
      email: 'cara2@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c2',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    expect(res.headers.location).toBe('/settings?linkError=has_google');
  });

  it('is idempotent re-linking the same Google account to the same user', async () => {
    const { userId } = await registerWithSession('linkcb-dan');
    mockExchange.mockResolvedValue({
      sub: 'linkcb-dan-sub',
      email: 'dan@example.com',
      emailVerified: true,
      name: null,
    });
    await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c1',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c2',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });
    expect(res.headers.location).toBe('/settings?linked=google');
  });

  it('deep-links success back to the native app', async () => {
    const { userId } = await registerWithSession('linkcb-erin');
    mockExchange.mockResolvedValue({
      sub: 'linkcb-erin-sub',
      email: 'erin@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'auth-code',
        state: signOAuthState({ platform: 'native', mode: 'link', userId }),
      });
    expect(res.headers.location).toBe('https://spellcontrol.com/oauth/callback?linked=google');
  });
});

describe('DELETE /api/auth/me/identities/google', () => {
  it('unlinks the Google identity from a password account', async () => {
    const { cookie, userId } = await registerWithSession('unlink-alice');
    mockExchange.mockResolvedValue({
      sub: 'unlink-alice-sub',
      email: 'unlinkalice@example.com',
      emailVerified: true,
      name: null,
    });
    await request(app)
      .get('/api/auth/google/callback')
      .query({
        code: 'c',
        state: signOAuthState({ platform: 'web', mode: 'link', userId }),
      });

    const res = await request(app).delete('/api/auth/me/identities/google').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE user_id = '${userId}'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuses to unlink the only sign-in method for an SSO-only account', async () => {
    const created = await createGoogleAccount(
      'unlink-sso-sub',
      'unlinksso@example.com',
      'unlink-sso'
    );
    const cookie = extractSessionCookie(created.headers['set-cookie'])!;
    const res = await request(app).delete('/api/auth/me/identities/google').set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('Google callback — same-email auto-link', () => {
  async function registerAndSetEmail(
    username: string,
    email: string,
    opts: { emailVerified?: boolean } = {}
  ): Promise<{ userId: string }> {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, password: 'correct horse battery' });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id as string;
    await pool.query('UPDATE users SET email = $1, email_verified = $2 WHERE id = $3', [
      email,
      opts.emailVerified ?? false,
      userId,
    ]);
    return { userId };
  }

  it('attaches a Google identity to a password account when verified email matches', async () => {
    const { userId } = await registerAndSetEmail('autolink-alice', 'alice@example.com');
    // Before: no Google identity on this user.
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE user_id = '${userId}'`
    );
    expect(before.rows[0].n).toBe(0);

    const res = await callback('google-alice-sub', 'alice@example.com', 'web');
    expect(res.status).toBe(302);
    // Signed straight in — no choose-username detour.
    expect(res.headers.location).toBe('/');
    expect(extractSessionCookie(res.headers['set-cookie'])).toBeTruthy();

    // Identity row inserted on the existing user.
    const after = await pool.query(
      `SELECT provider, provider_subject FROM auth_identities WHERE user_id = '${userId}'`
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({
      provider: 'google',
      provider_subject: 'google-alice-sub',
    });
    // Banner audit timestamp stamped.
    const userRow = await pool.query(
      `SELECT auto_linked_at, email_verified FROM users WHERE id = '${userId}'`
    );
    expect(typeof userRow.rows[0].auto_linked_at).toBe('string'); // BIGINT comes back as string
    expect(userRow.rows[0].email_verified).toBe(true);
  });

  it('deep-links a native handoff code on auto-link', async () => {
    await registerAndSetEmail('autolink-native', 'native@example.com');
    const res = await callback('google-native-sub', 'native@example.com', 'native');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/spellcontrol\.com\/oauth\/callback\?code=/);
  });

  it('does NOT auto-link when Google says email is unverified', async () => {
    await registerAndSetEmail('autolink-unverified', 'unverified@example.com');
    mockExchange.mockResolvedValue({
      sub: 'unverified-sub',
      email: 'unverified@example.com',
      emailVerified: false,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: signOAuthState({ platform: 'web' }) });
    // Falls through to choose-username — no silent link.
    expect(res.headers.location).toMatch(/^\/auth\/choose-username#/);
    const identities = await pool.query(
      `SELECT count(*)::int AS n FROM auth_identities WHERE provider_subject = 'unverified-sub'`
    );
    expect(identities.rows[0].n).toBe(0);
  });

  it('does NOT auto-link when the target user already has a Google identity', async () => {
    // Two accounts: one with Google linked at email A, one password-only with the same email.
    // Realistically impossible (email is UNIQUE), but cover the more realistic case: a single
    // user already has a Google identity attached, and another Google account with the same
    // email tries to sign in. We refuse — they must link via password.
    await createGoogleAccount('autolink-existing-sub', 'taken@example.com', 'autolink-taken');
    // Now a *different* Google account with the same email tries to sign in.
    mockExchange.mockResolvedValue({
      sub: 'autolink-attacker-sub',
      email: 'taken@example.com',
      emailVerified: true,
      name: null,
    });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: signOAuthState({ platform: 'web' }) });
    // Not silently linked into the existing user; sent to choose-username instead.
    expect(res.headers.location).toMatch(/^\/auth\/choose-username#/);
  });

  it('does NOT auto-link when no account has that email', async () => {
    // Email mismatch — no user with this email exists. Falls through to choose-username.
    const res = await callback('lonely-sub', 'nobody@example.com', 'web');
    expect(res.headers.location).toMatch(/^\/auth\/choose-username#/);
  });

  it('GET /me exposes autoLinkedAt for the user; POST /me/acknowledge-auto-link clears it', async () => {
    await registerAndSetEmail('autolink-ack', 'ack@example.com');
    const cbRes = await callback('ack-sub', 'ack@example.com', 'web');
    const cookie = extractSessionCookie(cbRes.headers['set-cookie'])!;

    const me1 = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me1.status).toBe(200);
    expect(typeof me1.body.autoLinkedAt).toBe('number');

    const ack = await request(app).post('/api/auth/me/acknowledge-auto-link').set('Cookie', cookie);
    expect(ack.status).toBe(200);

    const me2 = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me2.body.autoLinkedAt).toBeNull();
  });

  it('unlinking the auto-linked Google identity also clears the banner', async () => {
    await registerAndSetEmail('autolink-unlink', 'unlinkme@example.com');
    const cbRes = await callback('unlinkme-sub', 'unlinkme@example.com', 'web');
    const cookie = extractSessionCookie(cbRes.headers['set-cookie'])!;

    const unlink = await request(app)
      .delete('/api/auth/me/identities/google')
      .set('Cookie', cookie);
    expect(unlink.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.autoLinkedAt).toBeNull();
  });
});

describe('sign-in method self-stranding guard', () => {
  // The Google unlink endpoint already refuses for SSO-only accounts (tested
  // above); these cases pin the contract that the guard delegates to a
  // shared helper so future "remove method" endpoints inherit the same rule.
  it('unlink-Google succeeds when the user still has a password', async () => {
    const { cookie } = await registerWithSession('strand-pw-google', 'correct horse battery');
    // Manually attach a Google identity via the DB so we don't need a full
    // OAuth dance for this case.
    const userIdRow = await pool.query(`SELECT id FROM users WHERE username = 'strand-pw-google'`);
    const userId = userIdRow.rows[0].id;
    await pool.query(
      `INSERT INTO auth_identities (provider, provider_subject, user_id, created_at)
       VALUES ('google', 'strand-google-sub', $1, $2)`,
      [userId, Date.now()]
    );
    const res = await request(app).delete('/api/auth/me/identities/google').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('refuses unlink-Google when it is the only sign-in method (SSO-only account)', async () => {
    // Two-pass safety net: alongside the existing "refuses to unlink for
    // SSO-only" case, confirms the helper-based path returns the same 409.
    const created = await createGoogleAccount(
      'strand-sso-sub',
      'strandsso@example.com',
      'strand-sso'
    );
    const cookie = extractSessionCookie(created.headers['set-cookie'])!;
    const res = await request(app).delete('/api/auth/me/identities/google').set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/lock you out/i);
  });
});
