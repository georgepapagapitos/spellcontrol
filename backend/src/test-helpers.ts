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
import { scannerRouter } from './routes/scanner';

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
    CREATE SEQUENCE user_data_rev_seq;
    CREATE TABLE user_imports (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_imports_rev_idx ON user_imports(user_id, rev);
    CREATE TABLE user_cards (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_cards_rev_idx ON user_cards(user_id, rev);
    CREATE INDEX user_cards_import_idx ON user_cards(user_id, import_id);
    CREATE TABLE user_binders (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_binders_rev_idx ON user_binders(user_id, rev);
    CREATE TABLE user_decks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_decks_rev_idx ON user_decks(user_id, rev);
    CREATE TABLE user_games (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_games_rev_idx ON user_games(user_id, rev);
    CREATE TABLE user_lists (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB,
      rev BIGINT NOT NULL,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX user_lists_rev_idx ON user_lists(user_id, rev);
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
  app.use('/api/scanner', scannerRouter);

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

/**
 * Test helper that lets a suite express the user's full sync state in the
 * old "one big blob" shape and applies it to the new per-entity sync API.
 * Computes the diff against the current server state — rows in the body get
 * upserted, rows that exist on the server but are missing from the body get
 * tombstoned — so callers can keep writing `setSnapshot(cookie, { decks: [] })`
 * to mean "delete every deck" without thinking about deltas.
 *
 * Only used by share / OG / sync route integration tests. Returns the post-
 * apply cursor (handy when a test needs to assert progress).
 */
import type request from 'supertest';

/**
 * Use the same shape supertest's `request()` returns. `TestAgent` is exposed
 * as a named type on the default export; the SuperTest<Test> alias the
 * older docs reference no longer matches the agent type since v7.
 */
type SuperTestAgent = ReturnType<typeof request>;

export interface SnapshotShape {
  collection?: {
    cards?: Array<Record<string, unknown>>;
    importHistory?: Array<Record<string, unknown>>;
    lists?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  } | null;
  binders?: Array<Record<string, unknown>>;
  decks?: Array<Record<string, unknown>>;
  games?: Array<Record<string, unknown>>;
}

export async function setSnapshotViaSyncApi(
  http: SuperTestAgent,
  cookie: string,
  body: SnapshotShape
): Promise<number> {
  const pull = await http.get('/api/sync?since=0&limit=5000').set('Cookie', cookie);
  if (pull.status !== 200) {
    throw new Error(`setSnapshotViaSyncApi: pull failed with ${pull.status}`);
  }
  const liveByKind: Record<string, Set<string>> = {};
  for (const r of pull.body.rows as Array<{ kind: string; id: string; deletedAt: number | null }>) {
    if (r.deletedAt == null) {
      (liveByKind[r.kind] ??= new Set<string>()).add(r.id);
    }
  }

  const desired = {
    card: (body.collection?.cards ?? []) as Array<{ copyId: string; importId?: string }>,
    import: (body.collection?.importHistory ?? []) as Array<{ id: string }>,
    list: (body.collection?.lists ?? []) as Array<{ id: string }>,
    binder: (body.binders ?? []) as Array<{ id: string }>,
    deck: (body.decks ?? []) as Array<{ id: string }>,
    game: (body.games ?? []) as Array<{ id: string }>,
  };

  const upserts: Array<{ kind: string; id: string; data: unknown; importId?: string }> = [];
  const desiredIds: Record<string, Set<string>> = {};

  for (const c of desired.card) {
    upserts.push({ kind: 'card', id: c.copyId, data: c, importId: c.importId ?? '' });
    (desiredIds.card ??= new Set<string>()).add(c.copyId);
  }
  for (const e of desired.import) {
    upserts.push({ kind: 'import', id: e.id, data: e });
    (desiredIds.import ??= new Set<string>()).add(e.id);
  }
  for (const e of desired.list) {
    upserts.push({ kind: 'list', id: e.id, data: e });
    (desiredIds.list ??= new Set<string>()).add(e.id);
  }
  for (const e of desired.binder) {
    upserts.push({ kind: 'binder', id: e.id, data: e });
    (desiredIds.binder ??= new Set<string>()).add(e.id);
  }
  for (const e of desired.deck) {
    upserts.push({ kind: 'deck', id: e.id, data: e });
    (desiredIds.deck ??= new Set<string>()).add(e.id);
  }
  for (const e of desired.game) {
    upserts.push({ kind: 'game', id: e.id, data: e });
    (desiredIds.game ??= new Set<string>()).add(e.id);
  }

  const deletions: Array<{ kind: string; id: string }> = [];
  for (const [kind, ids] of Object.entries(liveByKind)) {
    const keep = desiredIds[kind] ?? new Set<string>();
    for (const id of ids) {
      if (!keep.has(id)) deletions.push({ kind, id });
    }
  }

  if (upserts.length === 0 && deletions.length === 0) return 0;
  const res = await http.post('/api/sync').set('Cookie', cookie).send({ upserts, deletions });
  if (res.status !== 200) {
    throw new Error(
      `setSnapshotViaSyncApi: POST failed with ${res.status} — ${JSON.stringify(res.body)}`
    );
  }
  return res.body.cursor as number;
}
