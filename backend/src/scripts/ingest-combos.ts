/**
 * One-shot CLI: pull the Spellbook bulk variants and ingest them into the
 * local Postgres. Intended for first-run population and recovery from a
 * failed scheduled run. Reads DATABASE_URL from the environment exactly like
 * the server does.
 *
 * Usage:
 *   tsx --env-file .env src/scripts/ingest-combos.ts
 */
import { closeDb } from '../db';
import { fetchSpellbookBulk, ingestCombos } from '../combos/ingest';

async function main(): Promise<void> {
  console.log('[ingest-combos] fetching Spellbook bulk variants...');
  const variants = await fetchSpellbookBulk();
  console.log(`[ingest-combos] fetched ${variants.length} variants, writing to db...`);
  const start = Date.now();
  const result = await ingestCombos(variants);
  const elapsed = Date.now() - start;
  console.log(
    `[ingest-combos] done in ${elapsed}ms — wrote ${result.written}, skipped ${result.skipped} (run ${result.runId})`
  );
}

main()
  .catch((err) => {
    console.error('[ingest-combos] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
