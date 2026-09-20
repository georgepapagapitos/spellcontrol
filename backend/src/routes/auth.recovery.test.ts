import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

// The route hands the raw token to sendMail() inside a `.../reset-password?
// token=…` link — capturing the call is how these tests recover a token
// without a real inbox. mail.ts itself is unit-tested separately.
const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock('../mail', () => ({ sendMail: mockSendMail, isMailConfigured: () => false }));

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

beforeEach(() => {
  mockSendMail.mockReset();
});

function tokenFromLastMail(): string {
  const call = mockSendMail.mock.calls.at(-1)?.[0] as { text: string } | undefined;
  const match = call?.text.match(/token=([^\s]+)/);
  if (!match) throw new Error('No token found in the last sendMail() call.');
  return decodeURIComponent(match[1]);
}

async function registerAndVerify(username: string, email: string) {
  const register = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  const cookie = extractSessionCookie(register.headers['set-cookie']);
  await request(app).post('/api/auth/me/email').set('Cookie', cookie!).send({ email });
  const token = tokenFromLastMail();
  await request(app).post('/api/auth/verify-email').send({ token });
  return cookie!;
}

describe('POST /api/auth/me/email + POST /api/auth/verify-email', () => {
  it('issues a token, verifies it, and marks the email verified', async () => {
    const register = await request(app).post('/api/auth/register').send({
      username: 'em-alice',
      password: 'correct horse battery',
      email: 'em-alice@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    // Registration sends its own verification mail for the address given at
    // sign-up; this case is about CHANGING that address afterwards.
    mockSendMail.mockClear();

    const start = await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'alice@example.com' });
    expect(start.status).toBe(202);
    expect(start.body.pendingEmail).toBe('alice@example.com');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('alice@example.com');

    const identitiesBefore = await request(app)
      .get('/api/auth/me/identities')
      .set('Cookie', cookie!);
    expect(identitiesBefore.body.pendingEmail).toBe('alice@example.com');
    expect(identitiesBefore.body.emailVerified).toBe(false);

    const token = tokenFromLastMail();
    const verify = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);

    const identitiesAfter = await request(app)
      .get('/api/auth/me/identities')
      .set('Cookie', cookie!);
    expect(identitiesAfter.body.email).toBe('alice@example.com');
    expect(identitiesAfter.body.emailVerified).toBe(true);
    expect(identitiesAfter.body.pendingEmail).toBeNull();
  });

  it('rejects an unknown, expired, or reused token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'not-a-real-token' });
    expect(res.status).toBe(400);

    const register = await request(app).post('/api/auth/register').send({
      username: 'em-bob',
      password: 'correct horse battery',
      email: 'em-bob@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'bob@example.com' });
    const token = tokenFromLastMail();
    const first = await request(app).post('/api/auth/verify-email').send({ token });
    expect(first.status).toBe(200);
    const reused = await request(app).post('/api/auth/verify-email').send({ token });
    expect(reused.status).toBe(400);
  });

  it('refuses to claim an email another VERIFIED account already owns', async () => {
    await registerAndVerify('em-carol', 'carol@example.com');

    const register = await request(app).post('/api/auth/register').send({
      username: 'em-dave',
      password: 'correct horse battery',
      email: 'em-dave@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    const res = await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'carol@example.com' });
    expect(res.status).toBe(409);
  });

  it('answers 409, not 500, when two accounts race to verify the same address', async () => {
    // Both may REQUEST the address (the pre-check only blocks verified
    // owners); whoever clicks second hits the unique index, which drizzle
    // surfaces as a wrapped DrizzleQueryError.
    const tokens: string[] = [];
    for (const username of ['em-race-1', 'em-race-2']) {
      const register = await request(app)
        .post('/api/auth/register')
        .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
      const cookie = extractSessionCookie(register.headers['set-cookie']);
      await request(app)
        .post('/api/auth/me/email')
        .set('Cookie', cookie!)
        .send({ email: 'race@example.com' });
      tokens.push(tokenFromLastMail());
    }

    const first = await request(app).post('/api/auth/verify-email').send({ token: tokens[0] });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/auth/verify-email').send({ token: tokens[1] });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/another account/);
  });

  it('rejects a malformed email', async () => {
    const register = await request(app).post('/api/auth/register').send({
      username: 'em-erin',
      password: 'correct horse battery',
      email: 'em-erin@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    const res = await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/me/email/resend', () => {
  it('re-sends the newest pending verify token', async () => {
    const register = await request(app).post('/api/auth/register').send({
      username: 'em-frank',
      password: 'correct horse battery',
      email: 'em-frank@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'frank@example.com' });
    mockSendMail.mockClear();

    const resend = await request(app)
      .post('/api/auth/me/email/resend')
      .set('Cookie', cookie!)
      .send({});
    expect(resend.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('frank@example.com');
  });

  it('400s when there is no pending email', async () => {
    const register = await request(app).post('/api/auth/register').send({
      username: 'em-grace',
      password: 'correct horse battery',
      email: 'em-grace@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    // Registration leaves a pending verification behind, so "nothing pending"
    // now means the sign-up token was already used — click it first.
    const verify = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromLastMail() });
    expect(verify.status).toBe(200);

    const res = await request(app)
      .post('/api/auth/me/email/resend')
      .set('Cookie', cookie!)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/forgot-password + POST /api/auth/reset-password', () => {
  it('always returns 200, whether or not the email is on a verified account', async () => {
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);

    const register = await request(app).post('/api/auth/register').send({
      username: 'fp-alice',
      password: 'correct horse battery',
      email: 'fp-alice@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    // Unverified email on the account: still 200, still no mail sent.
    await request(app)
      .post('/api/auth/me/email')
      .set('Cookie', cookie!)
      .send({ email: 'fp-alice@example.com' });
    mockSendMail.mockClear();
    const unverified = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'fp-alice@example.com' });
    expect(unverified.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('resets the password and signs the user in for a verified email', async () => {
    await registerAndVerify('fp-bob', 'fp-bob@example.com');
    mockSendMail.mockClear();

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'fp-bob@example.com' });
    expect(forgot.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    const token = tokenFromLastMail();
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'a brand new password' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.username).toBe('fp-bob');
    expect(extractSessionCookie(reset.headers['set-cookie'])).toBeTruthy();

    // Old password no longer works; new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'fp-bob', password: 'correct horse battery' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'fp-bob', password: 'a brand new password' });
    expect(newLogin.status).toBe(200);

    // The consumed token can't be replayed.
    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'yet another password' });
    expect(replay.status).toBe(400);
  });

  it('rejects a short password', async () => {
    await registerAndVerify('fp-carol', 'fp-carol@example.com');
    mockSendMail.mockClear();
    await request(app).post('/api/auth/forgot-password').send({ email: 'fp-carol@example.com' });
    const token = tokenFromLastMail();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/me/password', () => {
  it('requires and verifies currentPassword when the account already has one', async () => {
    // The "no currentPassword required" (SSO-only account) branch is
    // exercised end to end by the unlink-after-set-password test below,
    // which needs that exact account shape anyway.
    const register = await request(app).post('/api/auth/register').send({
      username: 'pw-alice',
      password: 'correct horse battery',
      email: 'pw-alice@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);

    const missingCurrent = await request(app)
      .post('/api/auth/me/password')
      .set('Cookie', cookie!)
      .send({ newPassword: 'a totally different password' });
    expect(missingCurrent.status).toBe(400);

    const wrongCurrent = await request(app)
      .post('/api/auth/me/password')
      .set('Cookie', cookie!)
      .send({ currentPassword: 'nope', newPassword: 'a totally different password' });
    expect(wrongCurrent.status).toBe(401);

    const ok = await request(app).post('/api/auth/me/password').set('Cookie', cookie!).send({
      currentPassword: 'correct horse battery',
      newPassword: 'a totally different password',
    });
    expect(ok.status).toBe(200);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pw-alice', password: 'a totally different password' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a short new password', async () => {
    const register = await request(app).post('/api/auth/register').send({
      username: 'pw-bob',
      password: 'correct horse battery',
      email: 'pw-bob@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    const res = await request(app)
      .post('/api/auth/me/password')
      .set('Cookie', cookie!)
      .send({ currentPassword: 'correct horse battery', newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('unlink-after-set-password (the whole point of T117)', () => {
  it('DELETE /me/identities/google is 409 for an SSO-only account, then succeeds once POST /me/password sets one', async () => {
    // Simulate an SSO-only account shape: register normally (so there's a
    // linked Google identity to unlink), then null the password hash
    // directly — there's no Google OAuth test double wired into this suite
    // (see auth.oauth.test.ts for that), so this is the most direct way to
    // reach the exact "no password, no other identity" state the unlink
    // guard exists for.
    const register = await request(app).post('/api/auth/register').send({
      username: 'unlink-alice',
      password: 'correct horse battery',
      email: 'unlink-alice@example.test',
    });
    const cookie = extractSessionCookie(register.headers['set-cookie']);
    const userIdRow = await pool.query('SELECT id FROM users WHERE username = $1', [
      'unlink-alice',
    ]);
    const userId = userIdRow.rows[0].id as string;
    await pool.query('UPDATE users SET password_hash = NULL WHERE id = $1', [userId]);
    await pool.query(
      "INSERT INTO auth_identities (provider, provider_subject, user_id, created_at) VALUES ('google', $1, $2, $3)",
      [`sub-${userId}`, userId, Date.now()]
    );

    const beforePassword = await request(app)
      .delete('/api/auth/me/identities/google')
      .set('Cookie', cookie!);
    expect(beforePassword.status).toBe(409);
    expect(beforePassword.body.error).toMatch(/set a password/i);

    // POST /me/password sets a password directly (no currentPassword) since
    // the account has none — this is the satisfiable instruction the 409
    // above points at.
    const setPassword = await request(app)
      .post('/api/auth/me/password')
      .set('Cookie', cookie!)
      .send({ newPassword: 'a brand new password' });
    expect(setPassword.status).toBe(200);

    const afterPassword = await request(app)
      .delete('/api/auth/me/identities/google')
      .set('Cookie', cookie!);
    expect(afterPassword.status).toBe(200);
  });
});

describe('PATCH /api/auth/me/notify-email', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).patch('/api/auth/me/notify-email').send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('defaults to true, and toggles off/on, surfaced via GET /me/identities', async () => {
    const cookie = await registerAndVerify('notify-toggle', 'notify-toggle@example.com');
    const before = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    expect(before.body.notifyEmail).toBe(true);

    const off = await request(app)
      .patch('/api/auth/me/notify-email')
      .set('Cookie', cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    const afterOff = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    expect(afterOff.body.notifyEmail).toBe(false);

    const on = await request(app)
      .patch('/api/auth/me/notify-email')
      .set('Cookie', cookie)
      .send({ enabled: true });
    expect(on.status).toBe(200);
    const afterOn = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    expect(afterOn.body.notifyEmail).toBe(true);
  });

  it('rejects a non-boolean body (400)', async () => {
    const cookie = await registerAndVerify('notify-bad-body', 'notify-bad-body@example.com');
    const res = await request(app)
      .patch('/api/auth/me/notify-email')
      .set('Cookie', cookie)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register — the recovery address', () => {
  it('refuses a signup with no email, or a malformed one', async () => {
    for (const email of [undefined, '', 'not-an-address', 'no@domain', 42]) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'noemail', password: 'correct horse battery', email });
      expect(res.status, JSON.stringify(email)).toBe(400);
      expect(res.body.error).toBe('Enter a valid email address.');
    }
  });

  it('creates the account but leaves users.email unset until the link is clicked', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'pending-pat',
      password: 'correct horse battery',
      email: 'Pending.Pat@Example.com',
    });
    expect(res.status).toBe(201);
    // Echoed back normalized so the UI can say where the link went.
    expect(res.body.pendingEmail).toBe('pending.pat@example.com');

    const cookie = extractSessionCookie(res.headers['set-cookie'])!;
    const identities = await request(app).get('/api/auth/me/identities').set('Cookie', cookie);
    // Not on the row yet: writing it unverified would let anyone occupy the
    // unique index with an address they do not control.
    expect(identities.body.email).toBeNull();
    expect(identities.body.emailVerified).toBe(false);
    expect(identities.body.pendingEmail).toBe('pending.pat@example.com');
  });

  it('reports the unverified state on /me, which is what the banner reads', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      username: 'banner-bea',
      password: 'correct horse battery',
      email: 'banner-bea@example.test',
    });
    const cookie = extractSessionCookie(reg.headers['set-cookie'])!;

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.emailVerified).toBe(false);
  });

  it('refuses an address another VERIFIED account owns, without saying whose', async () => {
    await request(app).post('/api/auth/register').send({
      username: 'owner-olive',
      password: 'correct horse battery',
      email: 'contested@example.com',
    });
    // Verification is what makes the address spoken for — the link is public,
    // so no session is needed to click it.
    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromLastMail() })
      .expect(200);

    const second = await request(app).post('/api/auth/register').send({
      username: 'taker-tom',
      password: 'correct horse battery',
      email: 'contested@example.com',
    });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('That email is already in use.');
    // The copy must not name the account that holds it.
    expect(JSON.stringify(second.body)).not.toContain('owner-olive');
    // And the cookie check: no session was handed out.
    expect(extractSessionCookie(second.headers['set-cookie'])).toBeNull();
  });

  it('allows an address that is only PENDING on another account', async () => {
    // Nobody has proved they control it yet, so it is not spoken for — and
    // refusing here would let anyone block a signup by typing the address.
    await request(app).post('/api/auth/register').send({
      username: 'pend-one',
      password: 'correct horse battery',
      email: 'shared-pending@example.com',
    });
    const second = await request(app).post('/api/auth/register').send({
      username: 'pend-two',
      password: 'correct horse battery',
      email: 'shared-pending@example.com',
    });
    expect(second.status).toBe(201);
  });
});
