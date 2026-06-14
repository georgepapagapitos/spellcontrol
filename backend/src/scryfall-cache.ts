/**
 * Shared Scryfall SQLite cache singleton + price helper.
 *
 * The cache used to be a local `const` in server.ts, which meant other modules
 * (e.g. shares/context.ts, which stamps current prices onto shared cards now
 * that prices no longer ride the sync row) couldn't reach it. This module owns
 * the single instance + the DB path so any caller can `getScryfallCache()`.
 */

import path from 'node:path';
import { ScryfallCache } from './cache';
import type { ScryfallCard } from './types';

export const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scryfall-cache.db');

let instance: ScryfallCache | null = null;

/** The process-wide Scryfall cache. Created lazily on first use. */
export function getScryfallCache(): ScryfallCache {
  if (!instance) instance = new ScryfallCache(DB_PATH);
  return instance;
}

/**
 * Highest non-zero USD price across nonfoil / etched / foil for a cached card.
 * Returns 0 when Scryfall has no USD price. (Moved here from server.ts so the
 * shares projection can reuse it.)
 */
export function pickUsdFromPrices(card: ScryfallCard): number {
  const p = card.prices;
  if (!p) return 0;
  for (const raw of [p.usd, p.usd_etched, p.usd_foil]) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
