import { defineConfig } from 'vitest/config';

// Coverage thresholds are only enforced when the DB-backed tests can run —
// otherwise auth/sync route coverage is structurally unreachable and would
// trip the gate even on a clean checkout. CI sets TEST_DATABASE_URL via the
// postgres service, so the gate runs there.
const dbTestsEnabled = Boolean(
  process.env.TEST_DATABASE_URL || process.env.RUN_DB_TESTS === '1'
);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/server.ts',
        // Test infrastructure — only loaded by other tests, never shipped.
        'src/test-helpers.ts',
        // Pure type / table declarations; v8 reports them as 0% even though
        // they have no executable code in the build output.
        'src/db/schema.ts',
      ],
      thresholds: dbTestsEnabled
        ? { statements: 80, branches: 80, functions: 80, lines: 80 }
        : undefined,
    },
  },
});
