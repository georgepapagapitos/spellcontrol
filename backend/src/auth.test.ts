import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';
import { setDbForTesting, closeDb } from './db';
import { testDatabaseUrl } from './test-helpers';
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
  normalizeDisplayName,
  normalizeBio,
  isReservedUsername,
  isScryfallUuid,
  isScryfallArtUrl,
  resolveDisplayLabel,
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

describe('normalizeDisplayName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeDisplayName('  Pat  ')).toBe('Pat');
  });

  it('treats empty-after-trim as a clear (null)', () => {
    expect(normalizeDisplayName('')).toBeNull();
    expect(normalizeDisplayName('   ')).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
  });

  it('rejects over the 40-char cap instead of truncating', () => {
    expect(normalizeDisplayName('a'.repeat(40))).toBe('a'.repeat(40));
    expect(normalizeDisplayName('a'.repeat(41))).toBeUndefined();
  });

  it('rejects non-strings', () => {
    expect(normalizeDisplayName(42)).toBeUndefined();
  });
});

describe('normalizeBio', () => {
  it('trims and caps at 280 chars', () => {
    expect(normalizeBio('  hello there  ')).toBe('hello there');
    expect(normalizeBio('a'.repeat(280))).toBe('a'.repeat(280));
    expect(normalizeBio('a'.repeat(281))).toBeUndefined();
  });

  it('treats empty-after-trim as a clear (null)', () => {
    expect(normalizeBio('   ')).toBeNull();
    expect(normalizeBio(null)).toBeNull();
  });
});

describe('isReservedUsername', () => {
  it('matches known reserved words case-insensitively', () => {
    expect(isReservedUsername('admin')).toBe(true);
    expect(isReservedUsername('ADMIN')).toBe(true);
    expect(isReservedUsername('Support')).toBe(true);
  });

  it('does not substring-match', () => {
    expect(isReservedUsername('uprooted')).toBe(false);
  });

  it('accepts an unreserved word', () => {
    expect(isReservedUsername('dragonlord')).toBe(false);
  });
});

describe('isScryfallUuid', () => {
  it('accepts a well-formed Scryfall id', () => {
    expect(isScryfallUuid('56ebc372-aabd-4174-a943-c7bf59e5049f')).toBe(true);
  });

  it('rejects malformed shapes and non-strings', () => {
    expect(isScryfallUuid('not-a-uuid')).toBe(false);
    expect(isScryfallUuid(123)).toBe(false);
  });
});

describe('isScryfallArtUrl', () => {
  const id = '56ebc372-aabd-4174-a943-c7bf59e5049f';

  it('accepts a well-formed cards.scryfall.io https URL', () => {
    expect(isScryfallArtUrl(`https://cards.scryfall.io/art_crop/front/5/6/${id}.jpg`)).toBe(true);
  });

  it('rejects http://', () => {
    expect(isScryfallArtUrl(`http://cards.scryfall.io/art_crop/front/5/6/${id}.jpg`)).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isScryfallArtUrl(`https://cards.scryfall.io.evil.com/${id}.jpg`)).toBe(false);
  });

  it('rejects an unrelated host', () => {
    expect(isScryfallArtUrl('https://example.com/image.jpg')).toBe(false);
  });
});

describe('resolveDisplayLabel', () => {
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    schemaName = `t_${crypto.randomBytes(6).toString('hex')}`;
    pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schemaName}`).catch(() => {});
    });
    await pool.query(`SET search_path TO ${schemaName}`);
    await pool.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT,
        created_at BIGINT NOT NULL
      );
    `);
    await pool.query(
      `INSERT INTO users (id, username, display_name, created_at) VALUES
       ('u-with-name', 'namedbob', 'Bob T.', $1),
       ('u-without-name', 'plainjane', NULL, $1)`,
      [Date.now()]
    );
    setDbForTesting(pool, drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await closeDb();
  });

  it('prefers displayName when set', async () => {
    expect(await resolveDisplayLabel('u-with-name')).toBe('Bob T.');
  });

  it('falls back to username when displayName is null', async () => {
    expect(await resolveDisplayLabel('u-without-name')).toBe('plainjane');
  });
});
