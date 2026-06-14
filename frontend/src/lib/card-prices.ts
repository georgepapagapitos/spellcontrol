/**
 * Device-local card price cache, keyed by Scryfall printing id (`scryfallId`).
 *
 * Card prices are GLOBAL reference data — the same for everyone, sourced from
 * Scryfall — NOT per-user data. They must therefore never ride the per-user
 * sync path. Previously prices lived on the synced `EnrichedCard` row, so a
 * daily price refresh of a ~12k collection re-uploaded every row to the server
 * and re-pulled it on every other device (the "constantly syncing" churn, and a
 * boot-time OOM). This module holds prices on-device instead: the synced card
 * row carries no price, and `applyPrices` merges the live value back onto cards
 * in memory for display / sort / binder routing.
 *
 * ponytail: localStorage-backed — one keyed map, loaded once into memory at
 * boot and fully rewritten on refresh. The payload is small (unique printings ×
 * ~40 bytes ≈ well under the quota). If it ever janks on a huge library, move
 * to the device-local offline IDB (`spellcontrol-offline`), where the rest of
 * the reference data already lives. See [[project_offline_vs_sync_caches]].
 */

const LS_KEY = 'spellcontrol:card-prices';

export interface PriceEntry {
  /** USD market price; 0 when Scryfall has no price for this printing+finish. */
  usd: number;
  /** Epoch ms when this entry was last sourced/checked. */
  pricedAt: number;
}

/**
 * Cache key for a printing's price. Price depends on FINISH (a foil and a
 * non-foil of the same printing have different prices), so foil/etched copies
 * get their own key. Non-foil stays the bare `scryfallId` — that's the legacy
 * key, so existing cached entries keep working and only foils need repopulating.
 */
export function priceKey(scryfallId: string, finish?: string): string {
  return finish && finish !== 'nonfoil' ? `${scryfallId}:${finish}` : scryfallId;
}

let cache = new Map<string, PriceEntry>();
let loaded = false;

/** Load the cache from localStorage into memory. Idempotent; call once at boot. */
export function loadPrices(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) cache = new Map(Object.entries(JSON.parse(raw) as Record<string, PriceEntry>));
  } catch {
    cache = new Map();
  }
}

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* quota / unavailable — prices are a refreshable nicety, never critical */
  }
}

/** Merge fetched prices (keyed by scryfallId) into the device cache. */
export function setPrices(entries: Record<string, PriceEntry>): void {
  loadPrices();
  let changed = false;
  for (const [id, e] of Object.entries(entries)) {
    const cur = cache.get(id);
    if (cur && cur.usd === e.usd && cur.pricedAt === e.pricedAt) continue; // no-op
    cache.set(id, e);
    changed = true;
  }
  // Only touch localStorage when something actually changed — `persistCardsState`
  // re-seeds the whole collection's prices on every persist, and re-serializing
  // a large map on an unrelated mutation (e.g. renaming a binder) would jank.
  if (changed) persist();
}

export function getPrice(scryfallId: string, finish?: string): PriceEntry | undefined {
  loadPrices();
  return cache.get(priceKey(scryfallId, finish));
}

/** Test-only: reset the in-memory cache + loaded flag. */
export function _resetForTests(): void {
  cache = new Map();
  loaded = false;
}

/**
 * Return cards with `purchasePrice`/`pricedAt` filled from the device-local
 * cache. The synced card row carries NO price, so this is what gives an
 * in-memory card a usable price for display / sort / routing. The lookup is
 * FINISH-AWARE (a foil reads the foil price):
 *   - exact finish hit (`scryfallId:finish` for foil/etched) → use it;
 *   - else the bare-`scryfallId` non-foil entry (legacy cache, or a foil whose
 *     finish-specific price hasn't been refreshed yet) → use it as a stopgap;
 *   - else the card's own carried price (legacy synced row from before prices
 *     moved off-row) → keep it;
 *   - otherwise → 0 (Scryfall has no current price → honest $0).
 * `purchasePrice` is ALWAYS a number on the way out, so reducers/formatters
 * never see `undefined`/`NaN`. A new array is returned only when something
 * changed, so a no-op merge keeps the reference and downstream `useMemo`s skip.
 */
export function applyPrices<
  T extends { scryfallId: string; finish?: string; purchasePrice?: number; pricedAt?: number },
>(cards: T[]): T[] {
  loadPrices();
  let mutated = false;
  const out = cards.map((c) => {
    // Exact finish, then the bare non-foil entry as a transitional fallback.
    const e =
      cache.get(priceKey(c.scryfallId, c.finish)) ??
      (c.finish && c.finish !== 'nonfoil' ? cache.get(c.scryfallId) : undefined);
    const usd = e ? e.usd : (c.purchasePrice ?? 0);
    const pricedAt = e ? e.pricedAt : c.pricedAt;
    if (c.purchasePrice === usd && c.pricedAt === pricedAt) return c;
    mutated = true;
    return { ...c, purchasePrice: usd, pricedAt };
  });
  return mutated ? out : cards;
}
