/**
 * One-shot CLI: download Scryfall unique_artwork, embed every art_crop with
 * MobileCLIP2-S0, and write the packed binary the frontend consumes at
 * `frontend/public/scanner-v2/card-embeddings.bin`. Mirrors
 * src/scripts/ingest-card-hashes.ts.
 *
 * Usage (from backend/ with .env present):
 *   tsx --env-file .env src/scripts/ingest-card-embeddings.ts --limit 100
 *   tsx --env-file .env src/scripts/ingest-card-embeddings.ts
 *
 * Full ingest is ~52k images and inference is the dominant cost — expect
 * 1-2 hours wall time on CPU at concurrency 4. `--limit` truncates so the
 * pipeline can be verified end-to-end first.
 */
import * as path from 'node:path';
import { logger } from '../logger';
import { ingestCardEmbeddings } from '../scanner/embedding-ingest';

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

function parseConcurrency(argv: string[]): number | undefined {
  const idx = argv.indexOf('--concurrency');
  if (idx === -1) return undefined;
  const raw = argv[idx + 1];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--concurrency expects a positive number, got ${raw}`);
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv);
  const concurrency = parseConcurrency(process.argv);
  // Reuse the frontend-vendored model — same bytes, no duplication.
  const modelPath = path.resolve(
    process.cwd(),
    '../frontend/public/scanner-v2/embed/vision_model.onnx'
  );
  const outPath = path.resolve(process.cwd(), '../frontend/public/scanner-v2/card-embeddings.bin');

  logger.info(
    `[ingest-card-embeddings] starting → ${outPath}${limit ? ` (limit=${limit})` : ''}${concurrency ? ` (concurrency=${concurrency})` : ''}`
  );
  const result = await ingestCardEmbeddings({ modelPath, outPath, limit, concurrency });
  logger.info(
    `[ingest-card-embeddings] wrote ${result.written} records (${result.bytes} bytes) in ${result.elapsedMs}ms`
  );
}

main().catch((err) => {
  logger.error('[ingest-card-embeddings] failed:', err);
  process.exitCode = 1;
});
