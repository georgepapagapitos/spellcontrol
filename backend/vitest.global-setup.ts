/**
 * Vitest global setup.
 *
 * Runs once before any test worker is spawned. Resolves a Postgres URL using
 * this priority chain:
 *
 *   1. `TEST_DATABASE_URL` (or `DATABASE_URL`) explicitly set — used as-is. CI
 *      provides one via its postgres service.
 *   2. A throwaway Postgres container started via @testcontainers/postgresql.
 *      Means a clean `npm test` works without any prerequisites beyond a
 *      running Docker daemon, and behaves identically to CI.
 *
 * ⚠️ A step used to sit between those two: adopt whatever answers on the dev
 * URL (`localhost:5432`), saving the container's ~2s startup for anyone who had
 * already run `npm run db:up`. That was the cause of E239's "wandering 5s
 * timeout flakes," and it was worse than a flake — two problems, both from the
 * suite silently sharing a long-lived database it did not own:
 *
 *   - **Schema crossfire.** Every run sweeps `t_*` schemas (see below) and each
 *     test file drops its own on cleanup. With two suites running at once — two
 *     sessions, or a worktree beside the main checkout — one run drops the
 *     OTHER's *live* schemas mid-flight. It surfaces as `schema "t_xxxx" does
 *     not exist` and mass 500s, which reads exactly like the diff under test
 *     broke authentication, and it nearly got blamed on an unrelated PR.
 *   - **It was often not the dev container at all.** Where a host-native
 *     Postgres owns :5432 it shadows the container and gets adopted instead, so
 *     the suite ran its DDL inside a real populated dev database rather than a
 *     disposable one.
 *
 * A dedicated container per run costs ~2s and makes both impossible. Reusing a
 * database is still supported — point `TEST_DATABASE_URL` at one deliberately;
 * the suite just won't adopt one by accident any more.
 *
 * Env vars set here propagate to forked workers because vitest forks AFTER
 * globalSetup returns. `test-helpers.ts` reads `TEST_DATABASE_URL` for its
 * per-test schema bootstrap.
 *
 * Schema sweep: each createTestEnv() call builds its own `t_*` schema and
 * drops it in cleanup(); a hard kill (Ctrl-C, crash) can leak them. We sweep
 * before and after the run, but only for an explicitly-supplied database — a
 * throwaway container is fresh on start and discarded on stop, so there's
 * nothing to clean.
 */
import { Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Pin to match CI (.github/workflows/ci.yml uses postgres:16-alpine).
const CONTAINER_IMAGE = 'postgres:16-alpine';

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+):[^@]+@/, '$1:****@');
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
  // Only an explicitly-supplied database can outlive the run, so only that one
  // needs sweeping — and only that one can be shared with another suite.
  const usingSharedDb = Boolean(explicit);

  if (explicit) {
    url = explicit;
    console.log(`[vitest] using explicit TEST_DATABASE_URL ${redact(url)}`);
  } else {
    const started = await startThrowawayContainer();
    url = started.url;
    container = started.container;
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
