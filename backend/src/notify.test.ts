import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from './test-helpers';
import { notifyUser } from './notify';

// notifyUser() is a thin wrapper around sendMail() — capture the call instead
// of standing up a real inbox. mail.ts itself is unit-tested separately.
// vi.mock is hoisted above every import in this file (including the one
// above), so notifyUser already sees the mocked sendMail.
const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock('./mail', () => ({ sendMail: mockSendMail, isMailConfigured: () => false }));

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

/** Registers a user and, unless `verify` is false, verifies the given email
 *  on the account (so `notifyUser` can find it). Returns the id. */
async function makeUser(
  username: string,
  email: string,
  opts: { verify?: boolean } = {}
): Promise<string> {
  const register = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  const id = register.body.user.id as string;
  const cookie = extractSessionCookie(register.headers['set-cookie'])!;
  await request(app).post('/api/auth/me/email').set('Cookie', cookie).send({ email });
  if (opts.verify ?? true) {
    const token = tokenFromLastMail();
    await request(app).post('/api/auth/verify-email').send({ token });
  }
  mockSendMail.mockReset();
  return id;
}

describe('notifyUser', () => {
  it('emails a verified, opted-in recipient', async () => {
    const id = await makeUser('notify-ok', 'notify-ok@example.com');

    await notifyUser(id, 'friend_request', { fromLabel: 'Alice', path: '/friends?tab=requests' });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0] as { to: string; subject: string };
    expect(call.to).toBe('notify-ok@example.com');
    expect(call.subject).toBe('Alice sent you a friend request on SpellControl');
  });

  it('escapes a user-authored display name in the HTML body', async () => {
    const id = await makeUser('notify-escape', 'notify-escape@example.com');

    await notifyUser(id, 'friend_request', {
      fromLabel: '<a href="https://evil.example">Alice</a>',
      path: '/friends?tab=requests',
    });

    const call = mockSendMail.mock.calls[0][0] as { html: string; text: string };
    expect(call.html).not.toContain('<a href="https://evil.example">');
    expect(call.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Alice&lt;/a&gt;');
    // The plain-text twin is not markup, so it carries the name verbatim.
    expect(call.text).toContain('<a href="https://evil.example">Alice</a>');
  });

  it('does not email an unverified address', async () => {
    const id = await makeUser('notify-unverified', 'notify-unverified@example.com', {
      verify: false,
    });

    await notifyUser(id, 'trade_offer', { fromLabel: 'Bob', path: '/trades' });

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('does not email when notify_email is false', async () => {
    const id = await makeUser('notify-optout', 'notify-optout@example.com');
    await pool.query('UPDATE users SET notify_email = false WHERE id = $1', [id]);

    await notifyUser(id, 'trade_offer', { fromLabel: 'Bob', path: '/trades' });

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('resolves without throwing when sendMail rejects', async () => {
    const id = await makeUser('notify-throws', 'notify-throws@example.com');
    mockSendMail.mockRejectedValueOnce(new Error('mail provider down'));

    await expect(
      notifyUser(id, 'game_night_invite', {
        fromLabel: 'Carol',
        path: '/gn/abc',
        nightTitle: 'Thursday Commander',
      })
    ).resolves.toBeUndefined();
  });
});
