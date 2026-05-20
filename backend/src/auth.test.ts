import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
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
