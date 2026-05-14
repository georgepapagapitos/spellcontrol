import { Pool } from 'pg';
import { defineConfig } from 'vitest/config';

// Default points at the docker-compose dev DB. Kept in sync with
// src/test-helpers.ts → DEFAULT_TEST_DATABASE_URL.
const DEFAULT_URL = 'postgres://mtguser:mtgpassword@localhost:5432/mtgbinder';

/**
 * Try to connect to the dev Postgres so DB-backed tests can run without the
 * developer having to remember to export TEST_DATABASE_URL. Bounded to 1.5s
 * so a missing container doesn't add real time to the no-DB path. Mirrored
 * inside vitest.global-setup.ts; the config copy exists because vitest reads
 * `thresholds` at config-load time, *before* globalSetup runs.
 */
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

export default defineConfig(async () => {
  const explicit = Boolean(process.env.TEST_DATABASE_URL || process.env.RUN_DB_TESTS);
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;

  let dbTestsEnabled = explicit;
  if (!explicit) {
    dbTestsEnabled = await probeDb(url);
    if (dbTestsEnabled) {
      process.env.RUN_DB_TESTS = '1';
      process.env.TEST_DATABASE_URL = url;
    }
  }

  return {
    test: {
      environment: 'node',
      globals: true,
      include: ['src/**/*.test.ts'],
      globalSetup: ['./vitest.global-setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: [
          'src/server.ts',
          // Test infrastructure — only loaded by other tests, never shipped.
          'src/test-helpers.ts',
          // Pure type / table declarations; v8 reports them as 0% even
          // though they have no executable code in the build output.
          'src/db/schema.ts',
          // One-off ingest tool, exercised by running it against real
          // Scryfall bulk data + image CDN. Its building blocks (phash
          // math, phash-store search/upsert) are unit-tested separately.
          'src/scripts/**',
        ],
        // Coverage thresholds are only enforced when the DB-backed tests
        // can run — otherwise auth/sync/games route coverage is structurally
        // unreachable and would trip the gate even on a clean checkout. CI's
        // postgres service flips this on automatically.
        thresholds: dbTestsEnabled
          ? { statements: 80, branches: 80, functions: 80, lines: 80 }
          : undefined,
      },
    },
  };
});
