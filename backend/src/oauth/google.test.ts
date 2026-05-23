import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestEnv, dbTestsEnabled } from '../test-helpers';
import { generateUsername } from '../auth';
import { users, authIdentities } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';

// Mock the Google network surface — `getToken` / `verifyIdToken` are the only
// calls that touch the wire. `generateAuthUrl` is pure and runs for real.
const { mockGetToken, mockVerifyIdToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockVerifyIdToken: vi.fn(),
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl(opts: { state: string }) {
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(opts.state)}`;
    }
    getToken = mockGetToken;
    verifyIdToken = mockVerifyIdToken;
  },
}));

import {
  getGoogleConfig,
  isGoogleOAuthConfigured,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  findGoogleUser,
  createGoogleUser,
  mintHandoffCode,
  consumeHandoffCode,
} from './google';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_WEB_REDIRECT_URI = 'http://localhost:5173/api/auth/google/callback';
  process.env.OAUTH_NATIVE_REDIRECT_URI = 'http://localhost:3737/api/auth/google/callback';
});

beforeEach(() => {
  mockGetToken.mockReset();
  mockVerifyIdToken.mockReset();
});

function payload(claims: Record<string, unknown>) {
  mockGetToken.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
  mockVerifyIdToken.mockResolvedValue({ getPayload: () => claims });
}

describe('getGoogleConfig', () => {
  it('reads config from the environment', () => {
    expect(isGoogleOAuthConfigured()).toBe(true);
    expect(getGoogleConfig()?.clientId).toBe('test-client-id');
  });

  it('returns null when a var is missing', () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(getGoogleConfig()).toBeNull();
    expect(isGoogleOAuthConfigured()).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = saved;
  });
});

describe('buildGoogleAuthUrl', () => {
  it('produces a consent URL carrying the state', () => {
    const cfg = getGoogleConfig()!;
    const url = buildGoogleAuthUrl(cfg, 'web', 'state-abc');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state-abc');
  });
});

describe('exchangeGoogleCode', () => {
  it('returns verified identity claims', async () => {
    payload({ sub: 'g-123', email: 'pat@example.com', email_verified: true, name: 'Pat' });
    const identity = await exchangeGoogleCode(getGoogleConfig()!, 'web', 'auth-code');
    expect(identity).toEqual({
      sub: 'g-123',
      email: 'pat@example.com',
      emailVerified: true,
      name: 'Pat',
    });
  });

  it('treats an unverified email as such', async () => {
    payload({ sub: 'g-9', email: 'x@example.com', email_verified: false });
    const identity = await exchangeGoogleCode(getGoogleConfig()!, 'native', 'auth-code');
    expect(identity.emailVerified).toBe(false);
    expect(identity.name).toBeNull();
  });

  it('throws when Google returns no ID token', async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });
    await expect(exchangeGoogleCode(getGoogleConfig()!, 'web', 'c')).rejects.toThrow(/ID token/);
  });

  it('throws when the ID token has no subject', async () => {
    mockGetToken.mockResolvedValue({ tokens: { id_token: 't' } });
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'a@b.com' }) });
    await expect(exchangeGoogleCode(getGoogleConfig()!, 'web', 'c')).rejects.toThrow(/subject/);
  });
});

const d = dbTestsEnabled ? describe : describe.skip;

let cleanup: () => Promise<void>;

beforeAll(async () => {
  if (!dbTestsEnabled) return;
  const env = await createTestEnv();
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

d('findGoogleUser / createGoogleUser', () => {
  it('returns null before the account exists, the user after', async () => {
    expect(await findGoogleUser('sub-new')).toBeNull();
    const user = await createGoogleUser(
      { sub: 'sub-new', email: 'newcomer@example.com', emailVerified: true, name: 'New' },
      'chosen-name'
    );
    expect(user.username).toBe('chosen-name');
    const found = await findGoogleUser('sub-new');
    expect(found?.id).toBe(user.id);
  });

  it('persists the identity link and a passwordless account', async () => {
    const user = await createGoogleUser(
      { sub: 'sub-persist', email: 'persist@example.com', emailVerified: true, name: null },
      'persist-user'
    );
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, user.id));
    expect(rows[0].email).toBe('persist@example.com');
    expect(rows[0].emailVerified).toBe(true);
    expect(rows[0].passwordHash).toBeNull();
    const ids = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.providerSubject, 'sub-persist'));
    expect(ids[0].userId).toBe(user.id);
  });
});

d('handoff codes', () => {
  it('round-trips a single-use code', async () => {
    const user = await createGoogleUser(
      { sub: 'sub-handoff', email: 'handoff@example.com', emailVerified: true, name: null },
      'handoff-user'
    );
    const code = await mintHandoffCode(user.id);
    expect(await consumeHandoffCode(code)).toBe(user.id);
    // Single use — a second redemption fails.
    expect(await consumeHandoffCode(code)).toBeNull();
  });

  it('rejects an unknown code', async () => {
    expect(await consumeHandoffCode('never-minted')).toBeNull();
  });
});

d('generateUsername', () => {
  it('derives a username from the email local-part', async () => {
    expect(await generateUsername('plain.name@example.com')).toBe('plainname');
  });

  it('suffixes on collision', async () => {
    await createGoogleUser(
      { sub: 'sub-collide', email: 'collide@example.com', emailVerified: true, name: null },
      'collide'
    );
    // 'collide' is now taken — the next suggestion must differ.
    const next = await generateUsername('collide@example.com');
    expect(next).not.toBe('collide');
    expect(next.startsWith('collide')).toBe(true);
  });
});
