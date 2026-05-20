import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let dbInstance: Database | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

/** Test-only: inject a custom pool / db (e.g. against a per-test schema). */
export function setDbForTesting(p: Pool, d: Database): void {
  pool = p;
  dbInstance = d;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}

/**
 * Create the user-account tables if they do not already exist. Idempotent so it
 * can run on every backend start. Kept as raw SQL (rather than drizzle-kit
 * migrations) because the schema is small and we want zero external tooling at
 * deploy time.
 */
export async function ensureSchema(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      collection JSONB,
      binders JSONB NOT NULL DEFAULT '[]'::jsonb,
      decks JSONB NOT NULL DEFAULT '[]'::jsonb,
      games JSONB NOT NULL DEFAULT '[]'::jsonb,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
    ALTER TABLE user_data ADD COLUMN IF NOT EXISTS games JSONB NOT NULL DEFAULT '[]'::jsonb;
    CREATE TABLE IF NOT EXISTS user_data_backups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      snapshot JSONB NOT NULL,
      reason TEXT NOT NULL,
      prior_version INTEGER NOT NULL,
      prior_card_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_data_backups_user_idx
      ON user_data_backups(user_id, created_at);
    CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      state JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_sessions_host_idx ON game_sessions(host_user_id);
    CREATE INDEX IF NOT EXISTS game_sessions_updated_idx ON game_sessions(updated_at);

    CREATE TABLE IF NOT EXISTS combos (
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
    /* Migrate from the original text-only prerequisites column if it exists. */
    DO $do$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'combos' AND column_name = 'prerequisites' AND data_type = 'text'
      ) THEN
        ALTER TABLE combos ALTER COLUMN prerequisites TYPE JSONB
          USING CASE WHEN prerequisites IS NULL OR prerequisites = ''
            THEN NULL
            ELSE jsonb_build_object('easy', prerequisites)
          END;
      END IF;
    END
    $do$;
    CREATE TABLE IF NOT EXISTS combo_cards (
      combo_id TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      oracle_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      PRIMARY KEY (combo_id, oracle_id)
    );
    ALTER TABLE combo_cards ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS combo_cards_oracle_idx ON combo_cards(oracle_id);
    CREATE TABLE IF NOT EXISTS combo_ingest_runs (
      id TEXT PRIMARY KEY,
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      combos_written INTEGER,
      source TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      revoked_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS shares_user_idx ON shares(user_id);
    CREATE INDEX IF NOT EXISTS shares_resource_idx ON shares(user_id, kind, resource_id);
  `);
}
