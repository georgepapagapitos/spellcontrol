/**
 * One-shot CLI: pull Scryfall's `default_cards` bulk dump and ingest every paper
 * printing into the local SQLite card cache (the `cards` + `card_lookups`
 * tables). Intended for first-run population and recovery from a failed
 * scheduled run. Reads DB_PATH from the environment exactly like the server does.
 *
 * Always re-ingests unless `--if-stale` is passed, which applies the server's
 * 20h recency guard (CI restores a cached DB and only wants a top-up).
 * Set SCRYFALL_BULK_FLUSH_PAUSE_MS=0 where nothing else needs the event loop (CI).
 *
 * Usage:
 *   tsx --env-file .env src/scripts/ingest-scryfall-bulk.ts [--if-stale]
 *   npm run ingest:scryfall-bulk --prefix backend -- --if-stale
 */
import { logger } from '../logger';
import { ScryfallCache } from '../cache';
import { DB_PATH } from '../scryfall-cache';
import { runScryfallBulkIngest } from '../scryfall-bulk';

async function main(): Promise<void> {
  logger.info('[ingest-scryfall-bulk] streaming Scryfall default_cards into', DB_PATH);
  const cache = new ScryfallCache(DB_PATH);
  try {
    const ifStale = process.argv.includes('--if-stale');
    const result = await runScryfallBulkIngest(cache, DB_PATH, { force: !ifStale });
    if (result) {
      logger.info(
        `[ingest-scryfall-bulk] wrote ${result.written} cards, ${result.aliases} aliases`
      );
      // A dump that parsed to nothing is a failure, not a green run with an empty cache.
      if (result.written === 0) throw new Error('bulk dump produced no cards');
    }
  } finally {
    cache.close();
  }
}

main().catch((err) => {
  logger.error('[ingest-scryfall-bulk] failed:', err);
  process.exitCode = 1;
});
