/**
 * Wipe the dev Postgres schema, rebuild it via ensureSchema(), and seed a
 * single dev user. Intended for fast iteration when testing account flows —
 * lets you replay first-run, guest-collision, and auto-link scenarios from
 * a known clean state.
 *
 * Usage:
 *   npm run db:reset --prefix backend
 * Or directly:
 *   tsx --env-file .env src/scripts/reset-dev-db.ts
 *
 * Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1 / the
 * docker compose hostname `postgres`. That guard is the only thing standing
 * between this script and your prod Neon DB — do not weaken it.
 */
import crypto from 'crypto';
import { closeDb, ensureSchema, getDb, getPool } from '../db';
import { users, userData } from '../db/schema';
import { hashPassword } from '../auth';
import { logger } from '../logger';

const DEV_USERNAME = 'dev';
const DEV_PASSWORD = 'spellcontrol';
const DEV_EMAIL = 'dev@localhost';

function assertLocalDatabaseUrl(): void {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url || '(unset)'}`);
  }
  const safeHosts = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    'postgres',
    'spellcontrol-postgres-dev',
  ]);
  if (!safeHosts.has(host)) {
    throw new Error(
      `Refusing to reset DATABASE_URL host '${host}' — this script is dev-only. ` +
        `Safe hosts: ${[...safeHosts].join(', ')}.`
    );
  }
}

async function main(): Promise<void> {
  assertLocalDatabaseUrl();

  const pool = getPool();
  logger.info('[reset-dev-db] dropping all tables owned by this role...');
  // We can't `DROP SCHEMA public CASCADE` because the dev docker role
  // (`mtguser`) doesn't own the schema itself — only the tables it created
  // via ensureSchema(). Iterate every table in `public` instead; each is
  // owned by us, so DROP TABLE works. The DO-block runs a single round-trip
  // and cascades through FK references in one shot.
  await pool.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  logger.info('[reset-dev-db] rebuilding schema via ensureSchema()...');
  await ensureSchema();

  logger.info(`[reset-dev-db] seeding user "${DEV_USERNAME}" / "${DEV_PASSWORD}"...`);
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(DEV_PASSWORD);
  await db.insert(users).values({
    id,
    username: DEV_USERNAME,
    passwordHash,
    // Set email + verified=true so the same-email Google auto-link path is
    // testable end-to-end against this account.
    email: DEV_EMAIL,
    emailVerified: true,
    role: 'user',
    createdAt: now,
  });
  await db.insert(userData).values({
    userId: id,
    collection: null,
    binders: [],
    decks: [],
    version: 0,
    updatedAt: now,
  });

  logger.info('[reset-dev-db] done.');
  logger.info(`  username: ${DEV_USERNAME}`);
  logger.info(`  password: ${DEV_PASSWORD}`);
  logger.info(`  email:    ${DEV_EMAIL}  (verified)`);
  logger.info('  Restart the backend ("npm run dev") so it reconnects on the new schema.');
}

main()
  .catch((err) => {
    logger.error('[reset-dev-db] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
