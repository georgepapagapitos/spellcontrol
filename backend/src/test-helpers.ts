import crypto from 'crypto';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';
import { setDbForTesting, closeDb } from './db';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { syncRouter } from './routes/sync';
import { gamesRouter } from './routes/games';
import { combosRouter } from './routes/combos';
import { sharesRouter } from './routes/shares';
import { offlineRouter } from './routes/offline';

/**
 * Returns the Postgres connection string for tests. vitest.global-setup.ts
 * guarantees `TEST_DATABASE_URL` is set before any worker spawns (explicit
 * env → dev container → throwaway testcontainer), so this is always defined
 * at test time.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set — vitest.global-setup.ts should have set it. ' +
        'Did the testcontainer fail to start, or is this code running outside vitest?'
    );
  }
  return url;
}

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
      password_hash TEXT,
      email TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      role TEXT NOT NULL DEFAULT 'user',
      created_at BIGINT NOT NULL,
      auto_linked_at BIGINT
    );
    CREATE UNIQUE INDEX users_email_idx ON users(email);
    CREATE TABLE auth_identities (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (provider, provider_subject)
    );
    CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);
    CREATE TABLE oauth_handoff_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE user_data (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      collection JSONB,
      binders JSONB NOT NULL DEFAULT '[]'::jsonb,
      decks JSONB NOT NULL DEFAULT '[]'::jsonb,
      games JSONB NOT NULL DEFAULT '[]'::jsonb,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE user_data_backups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      snapshot JSONB NOT NULL,
      reason TEXT NOT NULL,
      prior_version INTEGER NOT NULL,
      prior_card_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX user_data_backups_user_idx ON user_data_backups(user_id, created_at);
    CREATE TABLE game_sessions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      state JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE combos (
      id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      produces JSONB NOT NULL,
      prerequisites JSONB,
      description TEXT,
      mana_needed TEXT,
      popularity INTEGER NOT NULL DEFAULT 0,
      legalities JSONB NOT NULL,
      card_count INTEGER NOT NULL,
      bracket INTEGER,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE combo_cards (
      combo_id TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      oracle_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      PRIMARY KEY (combo_id, oracle_id)
    );
    CREATE INDEX combo_cards_oracle_idx ON combo_cards(oracle_id);
    CREATE TABLE combo_ingest_runs (
      id TEXT PRIMARY KEY,
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      combos_written INTEGER,
      source TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE shares (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      revoked_at BIGINT
    );
    CREATE INDEX shares_user_idx ON shares(user_id);
    CREATE INDEX shares_resource_idx ON shares(user_id, kind, resource_id);
  `);

  const db = drizzle(pool, { schema });
  setDbForTesting(pool, db);

  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/combos', combosRouter);
  app.use('/api/shares', sharesRouter);
  app.use('/api/offline', offlineRouter);

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
    const match = /(?:^|; )(spellcontrol_session=[^;]+)/.exec(h);
    if (match) return match[1];
  }
  return null;
}
