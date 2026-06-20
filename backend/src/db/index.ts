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
      password_hash TEXT,
      email TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      role TEXT NOT NULL DEFAULT 'user',
      created_at BIGINT NOT NULL,
      auto_linked_at BIGINT
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    -- SSO support: password is now optional (Google-only accounts), and OAuth
    -- accounts carry an email. Idempotent so existing deployments migrate on boot.
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
    -- NULLs are distinct in a unique index, so password-only accounts (email
    -- NULL) never collide; this only enforces one account per real email.
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
    -- Same-email auto-link audit: timestamp of the most recent identity
    -- auto-attach via verified email. /me exposes it; the frontend banner
    -- clears it via POST /me/acknowledge-auto-link.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_linked_at BIGINT;
    CREATE TABLE IF NOT EXISTS auth_identities (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (provider, provider_subject)
    );
    CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);
    CREATE TABLE IF NOT EXISTS oauth_handoff_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    -- Per-entity sync tables. See db/schema.ts for the design rationale; the
    -- short version: each user-data row carries its own monotonic rev so a
    -- delete on one device propagates as a tombstone to every other device on
    -- its next pull, replacing the prior whole-blob user_data model whose PUT
    -- semantics could resurrect deleted rows from a stale device. rev is drawn
    -- from a single shared sequence.
    CREATE SEQUENCE IF NOT EXISTS user_data_rev_seq;
    CREATE TABLE IF NOT EXISTS user_imports (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_imports_rev_idx ON user_imports(user_id, rev);
    CREATE TABLE IF NOT EXISTS user_cards (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_cards_rev_idx ON user_cards(user_id, rev);
    CREATE INDEX IF NOT EXISTS user_cards_import_idx ON user_cards(user_id, import_id);
    CREATE TABLE IF NOT EXISTS user_binders (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_binders_rev_idx ON user_binders(user_id, rev);
    CREATE TABLE IF NOT EXISTS user_decks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_decks_rev_idx ON user_decks(user_id, rev);
    CREATE TABLE IF NOT EXISTS user_games (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_games_rev_idx ON user_games(user_id, rev);
    CREATE TABLE IF NOT EXISTS user_lists (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_lists_rev_idx ON user_lists(user_id, rev);
    CREATE TABLE IF NOT EXISTS user_cubes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS user_cubes_rev_idx ON user_cubes(user_id, rev);

    -- NOTE: the one-shot migration that folded the legacy single-blob
    -- user_data table into the per-entity tables above has been removed. It
    -- ran on every boot since the per-row rollout, is complete on all
    -- environments, and the legacy user_data / user_data_backups tables have
    -- been dropped. Nothing here references them anymore.
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
      bracket_tag TEXT,
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
    ALTER TABLE combos ADD COLUMN IF NOT EXISTS bracket_tag TEXT;
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
    ALTER TABLE shares ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'link';
    ALTER TABLE shares ADD COLUMN IF NOT EXISTS addressee_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS shares_user_idx ON shares(user_id);
    CREATE INDEX IF NOT EXISTS shares_resource_idx ON shares(user_id, kind, resource_id);
    CREATE INDEX IF NOT EXISTS shares_audience_idx ON shares(user_id, audience) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS shares_addressee_idx ON shares(addressee_id) WHERE addressee_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS friendships (
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      accepted_at BIGINT,
      PRIMARY KEY (requester_id, addressee_id)
    );
    CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id);
    CREATE INDEX IF NOT EXISTS friendships_status_idx ON friendships(status);
  `);
}
