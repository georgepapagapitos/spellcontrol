/**
 * One-shot CLI: pull Scryfall's `default_cards` bulk dump and ingest every paper
 * printing into the local SQLite card cache (the `cards` + `card_lookups`
 * tables). Intended for first-run population and recovery from a failed
 * scheduled run. Reads DB_PATH from the environment exactly like the server does.
 *
 * Usage:
 *   tsx --env-file .env src/scripts/ingest-scryfall-bulk.ts
 */
import path from 'node:path';
import { logger } from '../logger';
import { ScryfallCache } from '../cache';
import { runScryfallBulkIngest } from '../scryfall-bulk';

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'scryfall-cache.db');

async function main(): Promise<void> {
  logger.info('[ingest-scryfall-bulk] streaming Scryfall default_cards into', DB_PATH);
  const cache = new ScryfallCache(DB_PATH);
  try {
    // force: a manual run always re-ingests, ignoring the recency guard.
    await runScryfallBulkIngest(cache, DB_PATH, { force: true });
  } finally {
    cache.close();
  }
}

main().catch((err) => {
  logger.error('[ingest-scryfall-bulk] failed:', err);
  process.exitCode = 1;
});
