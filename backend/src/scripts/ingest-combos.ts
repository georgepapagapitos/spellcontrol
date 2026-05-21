/**
 * One-shot CLI: pull the Spellbook bulk variants and ingest them into the
 * local Postgres. Intended for first-run population and recovery from a
 * failed scheduled run. Reads DATABASE_URL from the environment exactly like
 * the server does.
 *
 * Usage:
 *   tsx --env-file .env src/scripts/ingest-combos.ts
 */
import { logger } from '../logger';
import { closeDb } from '../db';
import { ingestCombos, streamSpellbookVariants } from '../combos/ingest';

async function main(): Promise<void> {
  logger.info('[ingest-combos] streaming Spellbook bulk variants into db...');
  const start = Date.now();
  const result = await ingestCombos(streamSpellbookVariants());
  const elapsed = Date.now() - start;
  logger.info(
    `[ingest-combos] done in ${elapsed}ms — wrote ${result.written}, skipped ${result.skipped} (run ${result.runId})`
  );
}

main()
  .catch((err) => {
    logger.error('[ingest-combos] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
