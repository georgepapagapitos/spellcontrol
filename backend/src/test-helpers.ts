import crypto from 'crypto';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';
import { setDbForTesting, closeDb } from './db';
import { authRouter } from './routes/auth';
import { syncRouter } from './routes/sync';

/**
 * Returns a Postgres connection string for tests. Falls back to a sensible
 * default that matches the docker-compose dev DB, but CI / local devs can
 * override with TEST_DATABASE_URL.
 */
export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://binder:binder@localhost:5432/binder'
  );
}

/**
 * True when DB-backed tests should run. Devs without a local Postgres can
 * leave these unset and the auth/sync test files will skip themselves; CI
 * sets TEST_DATABASE_URL via the workflow's postgres service.
 */
export const dbTestsEnabled = Boolean(
  process.env.TEST_DATABASE_URL || process.env.RUN_DB_TESTS === '1'
);

export interface TestEnv {
  app: Express;
  pool: Pool;
  cleanup: () => Promise<void>;
}

/**
 * Spin up an Express app pointed at an isolated Postgres schema. Each test
 * file gets its own schema so they can run in parallel without colliding on
 * the shared `users` table.
 */
export async function createTestEnv(): Promise<TestEnv> {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test';
  const schemaName = `t_${crypto.randomBytes(6).toString('hex')}`;
  const url = testDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 4 });

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
  // search_path applies per-connection; set it as a default so every pooled
  // connection lands in our schema without us having to wrap each query.
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${schemaName}`).catch(() => {});
  });
  // Ensure the already-checked-out connection (used for the CREATE SCHEMA
  // above) also picks up the path before we run the schema bootstrap.
  await pool.query(`SET search_path TO ${schemaName}`);
  await pool.query(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE user_data (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      collection JSONB,
      binders JSONB NOT NULL DEFAULT '[]'::jsonb,
      decks JSONB NOT NULL DEFAULT '[]'::jsonb,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
  `);

  const db = drizzle(pool, { schema });
  setDbForTesting(pool, db);

  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);

  return {
    app,
    pool,
    cleanup: async () => {
      await pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await closeDb();
    },
  };
}

/** Pull the session cookie value out of a Set-Cookie header. */
export function extractSessionCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of headers) {
    const match = /(?:^|; )(binder_session=[^;]+)/.exec(h);
    if (match) return match[1];
  }
  return null;
}
