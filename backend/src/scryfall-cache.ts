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
 * Finish-aware USD price for a cached card: prefer the price for the owned
 * finish, then fall back across the others. Same ordering as `mergeCard`'s
 * import-time `resolvePrice` (the single source of truth for "which finish's
 * price to show") — keep them identical. Returns 0 when Scryfall has no usable
 * USD price for any finish.
 */
export function pickUsdForFinish(card: ScryfallCard, finish?: string): number {
  const p = card.prices;
  if (!p) return 0;
  const order =
    finish === 'etched'
      ? [p.usd_etched, p.usd_foil, p.usd]
      : finish === 'foil'
        ? [p.usd_foil, p.usd_etched, p.usd]
        : [p.usd, p.usd_etched, p.usd_foil];
  return firstPositive(order);
}

/**
 * Finish-aware EUR (Cardmarket) price. Scryfall has no `eur_etched`, so etched
 * shares the foil-first ordering. Returns 0 when Scryfall has no EUR price.
 */
export function pickEurForFinish(card: ScryfallCard, finish?: string): number {
  const p = card.prices;
  if (!p) return 0;
  const order =
    finish === 'etched' || finish === 'foil' ? [p.eur_foil, p.eur] : [p.eur, p.eur_foil];
  return firstPositive(order);
}

function firstPositive(order: Array<string | null | undefined>): number {
  for (const raw of order) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Back-compat alias: the non-foil-first pick. Equivalent to
 * `pickUsdForFinish(card, 'nonfoil')`.
 */
export function pickUsdFromPrices(card: ScryfallCard): number {
  return pickUsdForFinish(card, 'nonfoil');
}
