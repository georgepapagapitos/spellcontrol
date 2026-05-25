/**
 * Vitest global setup.
 *
 * Runs once before any test worker is spawned. Resolves a Postgres URL using
 * this priority chain:
 *
 *   1. `TEST_DATABASE_URL` (or `DATABASE_URL`) explicitly set — used as-is. CI
 *      provides one via its postgres service.
 *   2. The local dev container at the default URL, if reachable. Lets devs who
 *      already run `npm run db:up` reuse it.
 *   3. A throwaway Postgres container started via @testcontainers/postgresql.
 *      Means a clean `npm test` works without any prerequisites beyond a
 *      running Docker daemon, and behaves identically to CI.
 *
 * Env vars set here propagate to forked workers because vitest forks AFTER
 * globalSetup returns. `test-helpers.ts` reads `TEST_DATABASE_URL` for its
 * per-test schema bootstrap.
 *
 * Schema sweep: each createTestEnv() call builds its own `t_*` schema and
 * drops it in cleanup(); a hard kill (Ctrl-C, crash) can leak them. We sweep
 * before and after the run, but only against the shared dev DB — a throwaway
 * container is fresh on start and discarded on stop, so there's nothing to
 * clean.
 */
import { Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const DEV_DB_URL = 'postgres://mtguser:mtgpassword@localhost:5432/spellcontrol';

// Pin to match CI (.github/workflows/ci.yml uses postgres:16-alpine).
const CONTAINER_IMAGE = 'postgres:16-alpine';

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+):[^@]+@/, '$1:****@');
}

async function probeDb(url: string, timeoutMs = 1500): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: timeoutMs, max: 1 });
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

async function startThrowawayContainer(): Promise<{
  url: string;
  container: StartedPostgreSqlContainer;
}> {
  console.log(`[vitest] starting throwaway Postgres (${CONTAINER_IMAGE})…`);
  const t0 = Date.now();
  const container = await new PostgreSqlContainer(CONTAINER_IMAGE)
    .withDatabase('spellcontrol')
    .withUsername('spellcontrol')
    .withPassword('spellcontrol')
    .start();
  const url = container.getConnectionUri();
  console.log(
    `[vitest] testcontainer ready on port ${container.getPort()} in ${Date.now() - t0}ms`
  );
  return { url, container };
}

export default async function setup(): Promise<() => Promise<void>> {
  const explicit = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  let url: string;
  let container: StartedPostgreSqlContainer | undefined;
  let usingSharedDb: boolean;

  if (explicit) {
    url = explicit;
    usingSharedDb = true;
    console.log(`[vitest] using explicit TEST_DATABASE_URL ${redact(url)}`);
  } else if (await probeDb(DEV_DB_URL)) {
    url = DEV_DB_URL;
    usingSharedDb = true;
    console.log(`[vitest] using dev Postgres at ${redact(url)}`);
  } else {
    const started = await startThrowawayContainer();
    url = started.url;
    container = started.container;
    usingSharedDb = false;
  }

  process.env.TEST_DATABASE_URL = url;

  // Pre-test sweep — clean up leftovers from any previous killed run. Only
  // meaningful against the shared dev DB; a fresh container has nothing to
  // sweep.
  if (usingSharedDb) {
    try {
      const dropped = await dropLeakedSchemas(url);
      if (dropped.length > 0) {
        console.log(`[vitest] cleaned ${dropped.length} leaked schema(s) from a prior run`);
      }
    } catch (err) {
      console.warn('[vitest] pre-test schema sweep failed:', err);
    }
  }

  return async () => {
    if (container) {
      // Throwaway container — stop it and its volume. No schema sweep needed.
      try {
        await container.stop({ remove: true, removeVolumes: true });
      } catch (err) {
        console.warn('[vitest] failed to stop testcontainer:', err);
      }
      return;
    }
    // Shared DB — post-test sweep guards against any cleanup() that crashed.
    try {
      const dropped = await dropLeakedSchemas(url);
      if (dropped.length > 0) {
        console.log(`[vitest] post-run: dropped ${dropped.length} leaked schema(s)`);
      }
    } catch (err) {
      console.warn('[vitest] post-test schema sweep failed:', err);
    }
  };
}
