/**
 * Vitest global setup.
 *
 * Runs once before any test worker is spawned. Two jobs:
 *
 *   1. Auto-detect a reachable Postgres. If the dev container is up, light
 *      up the DB-backed test suites without the developer having to remember
 *      TEST_DATABASE_URL. If nothing is reachable, log a clear skip message
 *      instead of letting suites silently turn into a 36-skipped count.
 *
 *   2. Sweep any `t_*` schemas left behind by previous test runs that were
 *      killed mid-flight (Ctrl-C, crash, etc). Each createTestEnv() call
 *      builds its own schema; an orderly run drops them in cleanup(), but a
 *      hard kill leaves them.
 *
 * NOTE: env vars set here propagate to forked workers because vitest forks
 * AFTER globalSetup returns. setting RUN_DB_TESTS=1 / TEST_DATABASE_URL is
 * the same as the developer setting them in their shell — the per-test-file
 * `describe.skip` gates and `vitest.config.ts` threshold gate both pick
 * them up.
 */
import { Pool } from 'pg';

const DEFAULT_URL = 'postgres://mtguser:mtgpassword@localhost:5432/spellcontrol';

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+):[^@]+@/, '$1:****@');
}

async function probeDb(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1500, max: 1 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function dropLeakedSchemas(url: string): Promise<string[]> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const res = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname LIKE 't\\_%' ESCAPE '\\'
        AND nspname NOT IN ('pg_toast', 'pg_catalog', 'information_schema')`
    );
    for (const row of res.rows) {
      // Identifier comes only from pg_namespace.nspname, not user input — safe
      // to interpolate. Still quote for hygiene.
      await pool.query(`DROP SCHEMA "${row.nspname}" CASCADE`);
    }
    return res.rows.map((r) => r.nspname);
  } finally {
    await pool.end().catch(() => {});
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const explicit = Boolean(process.env.TEST_DATABASE_URL || process.env.RUN_DB_TESTS);
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;

  if (!explicit) {
    const reachable = await probeDb(url);
    if (reachable) {
      process.env.RUN_DB_TESTS = '1';
      process.env.TEST_DATABASE_URL = url;
      // eslint-disable-next-line no-console
      console.log(`[vitest] DB tests auto-enabled — reached ${redact(url)}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[vitest] DB tests skipped — couldn't reach ${redact(url)}. ` +
          `Start the dev container ('npm run db:up' from the repo root) or ` +
          `set TEST_DATABASE_URL to enable.`
      );
    }
  }

  const dbEnabled = Boolean(process.env.TEST_DATABASE_URL || process.env.RUN_DB_TESTS);

  // Pre-test sweep — clean up leftovers from any previous run that got killed.
  if (dbEnabled) {
    try {
      const dropped = await dropLeakedSchemas(url);
      if (dropped.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[vitest] cleaned ${dropped.length} leaked schema(s) from a prior run`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[vitest] pre-test schema sweep failed:', err);
    }
  }

  // Post-test sweep — guards against any cleanup() that itself crashed.
  return async () => {
    if (!dbEnabled) return;
    try {
      const dropped = await dropLeakedSchemas(url);
      if (dropped.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[vitest] post-run: dropped ${dropped.length} leaked schema(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[vitest] post-test schema sweep failed:', err);
    }
  };
}
