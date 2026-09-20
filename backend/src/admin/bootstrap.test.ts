import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { promoteAdminsAtBoot, promoteIfSeededAdmin } from './bootstrap';

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

afterEach(async () => {
  delete process.env.ADMIN_EMAILS;
  await pool.query('DELETE FROM users');
});

let seq = 0;

/** Insert a user row directly — this is about the seed, not about signup. */
async function makeUser(opts: {
  email?: string | null;
  emailVerified?: boolean;
  role?: string;
}): Promise<{ id: string; username: string }> {
  const id = `seed-user-${++seq}`;
  const username = `seeduser${seq}`;
  await pool.query(
    `INSERT INTO users (id, username, password_hash, email, email_verified, role, created_at)
     VALUES ($1, $2, 'x', $3, $4, $5, $6)`,
    [id, username, opts.email ?? null, opts.emailVerified ?? false, opts.role ?? 'user', Date.now()]
  );
  return { id, username };
}

async function roleOf(id: string): Promise<string> {
  const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]);
  return rows[0]!.role;
}

describe('promoteAdminsAtBoot', () => {
  it('promotes a user whose seeded email is verified', async () => {
    const user = await makeUser({ email: 'boss@example.com', emailVerified: true });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    await promoteAdminsAtBoot();

    expect(await roleOf(user.id)).toBe('admin');
  });

  it('refuses to promote a seeded email that is NOT verified', async () => {
    // The whole point of the verified gate: anyone can type an address into
    // the signup form, so an unverified match must hand out nothing.
    const impostor = await makeUser({ email: 'boss@example.com', emailVerified: false });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    await promoteAdminsAtBoot();

    expect(await roleOf(impostor.id)).toBe('user');
  });

  it('matches the address case-insensitively', async () => {
    const user = await makeUser({ email: 'Boss@Example.com', emailVerified: true });
    process.env.ADMIN_EMAILS = ' BOSS@example.COM ';

    await promoteAdminsAtBoot();

    expect(await roleOf(user.id)).toBe('admin');
  });

  it('is a no-op when the env var is unset, and never demotes', async () => {
    const admin = await makeUser({ email: 'old@example.com', emailVerified: true, role: 'admin' });

    await promoteAdminsAtBoot();

    // Additive: dropping someone from the list (or clearing it entirely) does
    // not take their seat away.
    expect(await roleOf(admin.id)).toBe('admin');
  });

  it('leaves users with no email alone', async () => {
    const user = await makeUser({ email: null });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    await promoteAdminsAtBoot();

    expect(await roleOf(user.id)).toBe('user');
  });
});

describe('promoteIfSeededAdmin', () => {
  it('promotes at the moment the address becomes verified', async () => {
    const user = await makeUser({ email: 'boss@example.com', emailVerified: true });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    expect(await promoteIfSeededAdmin(user.id, 'boss@example.com')).toBe(true);
    expect(await roleOf(user.id)).toBe('admin');
  });

  it('does nothing for an address that is not seeded', async () => {
    const user = await makeUser({ email: 'someone@example.com', emailVerified: true });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    expect(await promoteIfSeededAdmin(user.id, 'someone@example.com')).toBe(false);
    expect(await roleOf(user.id)).toBe('user');
  });

  it('does nothing while the row is still unverified', async () => {
    const user = await makeUser({ email: 'boss@example.com', emailVerified: false });
    process.env.ADMIN_EMAILS = 'boss@example.com';

    expect(await promoteIfSeededAdmin(user.id, 'boss@example.com')).toBe(false);
    expect(await roleOf(user.id)).toBe('user');
  });
});
