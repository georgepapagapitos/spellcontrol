import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  signOAuthState,
  verifyOAuthState,
  signSignupToken,
  verifySignupToken,
  normalizeUsername,
  validatePassword,
} from './auth';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test';
});

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('hunter2hunter2');
    expect(hash).not.toBe('hunter2hunter2');
    expect(await verifyPassword('hunter2hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a user', () => {
    const token = signSession({ id: 'u1', username: 'alice', role: 'user' });
    expect(verifySession(token)).toEqual({ id: 'u1', username: 'alice', role: 'user' });
  });

  it('rejects garbage tokens', () => {
    expect(verifySession('not-a-jwt')).toBeNull();
  });
});

describe('OAuth state tokens', () => {
  it('round-trips the platform', () => {
    expect(verifyOAuthState(signOAuthState({ platform: 'web' }))?.platform).toBe('web');
    expect(verifyOAuthState(signOAuthState({ platform: 'native' }))?.platform).toBe('native');
  });

  it('rejects garbage', () => {
    expect(verifyOAuthState('not-a-jwt')).toBeNull();
  });

  it('does not cross-validate with session tokens', () => {
    // Different audiences: a session token must not pass as state, and a
    // state token must not pass as a session.
    const session = signSession({ id: 'u1', username: 'alice', role: 'user' });
    expect(verifyOAuthState(session)).toBeNull();
    expect(verifySession(signOAuthState({ platform: 'web' }))).toBeNull();
  });
});

describe('OAuth signup tokens', () => {
  it('round-trips the verified identity', () => {
    const token = signSignupToken({
      provider: 'google',
      sub: 'g-42',
      email: 'pat@example.com',
      emailVerified: true,
    });
    expect(verifySignupToken(token)).toEqual({
      provider: 'google',
      sub: 'g-42',
      email: 'pat@example.com',
      emailVerified: true,
    });
  });

  it('rejects garbage and tokens of a different audience', () => {
    expect(verifySignupToken('not-a-jwt')).toBeNull();
    // A state token must not pass as a signup token.
    expect(verifySignupToken(signOAuthState({ platform: 'web' }))).toBeNull();
  });
});

describe('username validation', () => {
  it('accepts well-formed names', () => {
    expect(normalizeUsername('alice')).toBe('alice');
    expect(normalizeUsername('Alice_42')).toBe('alice_42');
    expect(normalizeUsername('  bob-the-builder  ')).toBe('bob-the-builder');
  });

  it('rejects bad inputs', () => {
    expect(normalizeUsername('')).toBeNull();
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('has space')).toBeNull();
    expect(normalizeUsername('emoji😀')).toBeNull();
    expect(normalizeUsername('a'.repeat(40))).toBeNull();
    expect(normalizeUsername(null)).toBeNull();
  });
});

describe('password validation', () => {
  it('accepts well-formed passwords', () => {
    expect(validatePassword('correct horse battery')).toBe('correct horse battery');
  });

  it('rejects too short / too long / non-strings', () => {
    expect(validatePassword('short')).toBeNull();
    expect(validatePassword('a'.repeat(300))).toBeNull();
    expect(validatePassword(123 as unknown)).toBeNull();
  });
});
