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
 * Close the singleton and forget it, so the next `getScryfallCache()` opens a
 * fresh one. The server never calls this — the cache lives as long as the
 * process. It exists for tests that point `DB_PATH` at a temp directory and
 * then delete it: on Windows an open SQLite handle makes `rmSync` fail with
 * EPERM, so a suite that touches any module reaching for the singleton could
 * not clean up after itself (`shares/card-release-dates.test.ts` failed in
 * `afterAll` for exactly this, while all of its assertions passed).
 */
export function closeScryfallCache(): void {
  instance?.close();
  instance = null;
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

export interface FinishPriceEntry {
  usd: number;
  usdFoil: number;
  usdEtched: number;
  eur: number;
  eurFoil: number;
  eurEtched: number;
  pricedAt: number;
}

/**
 * Body of `POST /api/refresh-prices`. Extracted from the route so its two
 * different emit rules are unit-testable — the route module exports nothing, so
 * nothing in it can be driven by supertest.
 *
 * `prices` carries a value per FINISH, because one printing serves
 * nonfoil + foil + etched copies and a foil must never show the non-foil price.
 * An entry is emitted only when SOME finish in SOME currency has a price, so a
 * genuinely unpriced printing stays "stale" on the client and gets retried
 * rather than freezing at $0.
 *
 * `releasedAt` is each printing's own release date, and is deliberately NOT
 * gated that way: an unpriced printing still has a release date, and applying
 * the price gate to it would permanently starve exactly those cards. It rides
 * this response because this is already the one request that walks a whole
 * collection by printing id — see `frontend/src/lib/card-release-dates.ts`.
 */
export function buildPriceRefreshPayload(
  cards: ScryfallCard[],
  now: number
): { prices: Record<string, FinishPriceEntry>; releasedAt: Record<string, string> } {
  const prices: Record<string, FinishPriceEntry> = {};
  const releasedAt: Record<string, string> = {};
  for (const card of cards) {
    if (card.released_at) releasedAt[card.id] = card.released_at;
    const usd = pickUsdForFinish(card, 'nonfoil');
    const usdFoil = pickUsdForFinish(card, 'foil');
    const usdEtched = pickUsdForFinish(card, 'etched');
    const eur = pickEurForFinish(card, 'nonfoil');
    const eurFoil = pickEurForFinish(card, 'foil');
    const eurEtched = pickEurForFinish(card, 'etched');
    if (usd > 0 || usdFoil > 0 || usdEtched > 0 || eur > 0 || eurFoil > 0 || eurEtched > 0) {
      prices[card.id] = { usd, usdFoil, usdEtched, eur, eurFoil, eurEtched, pricedAt: now };
    }
  }
  return { prices, releasedAt };
}
