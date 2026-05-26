/**
 * One-shot CLI: download Scryfall unique_artwork, pHash every art_crop, and
 * write the packed binary the frontend consumes at
 * `frontend/public/scanner-v2/card-hashes.bin`. Intended for first-run
 * population and nightly refresh; mirrors src/scripts/ingest-combos.ts.
 *
 * Usage (from backend/ with .env present):
 *   tsx --env-file .env src/scripts/ingest-card-hashes.ts
 *   tsx --env-file .env src/scripts/ingest-card-hashes.ts --limit 100
 *
 * Full ingest is ~90k images = ~30-60 minutes wall time depending on
 * network and the configured concurrency. `--limit` truncates for dev runs
 * so the matcher can be exercised end-to-end without burning an hour.
 */
import * as path from 'node:path';
import { logger } from '../logger';
import { ingestCardHashes } from '../scanner/hash-ingest';

function parseLimit(argv: string[]): number | undefined {
  const idx = argv.indexOf('--limit');
  if (idx === -1) return undefined;
  const raw = argv[idx + 1];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit expects a positive number, got ${raw}`);
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv);
  // Resolve relative to the backend cwd at runtime — both `tsx` (dev) and
  // compiled Node (prod) report the repo-relative path correctly.
  const outPath = path.resolve(process.cwd(), '../frontend/public/scanner-v2/card-hashes.bin');

  logger.info(`[ingest-card-hashes] starting → ${outPath}${limit ? ` (limit=${limit})` : ''}`);
  const result = await ingestCardHashes({ outPath, limit });
  logger.info(
    `[ingest-card-hashes] wrote ${result.written} records (${result.bytes} bytes) in ${result.elapsedMs}ms`
  );
}

main().catch((err) => {
  logger.error('[ingest-card-hashes] failed:', err);
  process.exitCode = 1;
});
