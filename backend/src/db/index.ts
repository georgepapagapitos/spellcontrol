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
      version INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
  `);
}
