import { defineConfig } from 'vitest/config';

// Postgres-backed tests are always available — globalSetup resolves a URL via
// (explicit env → dev container → throwaway testcontainer), so coverage
// thresholds are unconditional. See vitest.global-setup.ts.
export default defineConfig({
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
        // Pure type / table declarations; v8 reports them as 0% even though
        // they have no executable code in the build output.
        'src/db/schema.ts',
        // Network + disk IO (Scryfall bulk fetch, gzip-and-write). Verified
        // via integration: the offline route tests stub fetch and walk the
        // build path; the schedule-refresh timer can't be unit-tested without
        // a fake clock that fights the real-DB suite.
        'src/offline/bulk-cache.ts',
        // Scanner ingest scripts: one-shot CLIs that stream Scryfall bulk JSON
        // and either pHash or CLIP-embed every art_crop. The bulk of each is
        // network + sharp + ONNX glue; the pure helpers (binary packing,
        // L2 normalize, int8 quantize) are tested directly. Including the
        // glue in coverage drags the global floor under 80% without
        // measuring anything we can act on.
        'src/scanner/hash-ingest.ts',
        'src/scanner/embedding-ingest.ts',
        // Thin CLI wrappers around the ingests above + the combos ingest.
        'src/scripts/**',
      ],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
