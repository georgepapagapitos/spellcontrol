import { getPrice, priceKey, setPrices, type PriceEntry } from '@/lib/collection/card-prices';
import { fetchWithAbortTimeout } from '@/lib/api/fetch-utils';

/**
 * Background re-resolve of deck printings the device price cache has never
 * priced (a printing not in the collection). Deck cards are frozen copies, so
 * without this they read the price from the day they were added. Results land
 * in the same device price cache `priceOf` reads, so no stored deck row is
 * rewritten (no sync churn). Goes through /api/refresh-prices, which the server
 * answers from the nightly bulk dump, so it never spends Scryfall's rate limit
 * from the browser.
 */

/** A cached price older than this is asked for again. */
export const DECK_PRICE_TTL_MS = 24 * 60 * 60 * 1000;
/** Ids per request. */
export const DECK_PRICE_BATCH = 100;
/** Ids per resolve call, so a big decks index can't fire hundreds of requests. */
export const DECK_PRICE_MAX_IDS = 300;
/** After a failed or throttled request, stay quiet this long. */
export const DECK_PRICE_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

// Ids asked this session (priced or not), so an unpriced printing is not
// re-asked on every visit; reset after the TTL.
const attempted = new Map<string, number>();
const inFlight = new Set<string>();
let cooldownUntil = 0;

export function _resetDeckPriceResolveForTests(): void {
  attempted.clear();
  inFlight.clear();
  cooldownUntil = 0;
}

type Wire = Record<string, { usd?: number; eur?: number; pricedAt: number }>;

/** Ids from `ids` that need a fetch: no fresh cache entry, not asked recently. */
export function staleDeckPriceIds(ids: Iterable<string>, now = Date.now()): string[] {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    if (!id || inFlight.has(id)) continue;
    const at = attempted.get(id);
    if (at !== undefined && now - at < DECK_PRICE_TTL_MS) continue;
    const e = getPrice(id);
    if (e && now - e.pricedAt < DECK_PRICE_TTL_MS && (e.usd > 0 || (e.eur ?? 0) > 0)) continue;
    out.push(id);
  }
  return out;
}

/** Fetch and cache prices for the stale ids in `ids`. Never throws. */
export async function resolveDeckPrices(ids: Iterable<string>): Promise<void> {
  const now = Date.now();
  if (now < cooldownUntil) return;
  const wanted = staleDeckPriceIds(ids, now).slice(0, DECK_PRICE_MAX_IDS);
  for (let i = 0; i < wanted.length; i += DECK_PRICE_BATCH) {
    if (Date.now() < cooldownUntil) return;
    const batch = wanted.slice(i, i + DECK_PRICE_BATCH);
    batch.forEach((id) => inFlight.add(id));
    try {
      const res = await fetchWithAbortTimeout(
        '/api/refresh-prices',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scryfallIds: batch }),
        },
        REQUEST_TIMEOUT_MS,
        'Price lookup timed out.'
      );
      if (!res.ok) {
        cooldownUntil = Date.now() + DECK_PRICE_COOLDOWN_MS;
        return;
      }
      const json = (await res.json()) as { prices?: Wire };
      const entries: Record<string, PriceEntry> = {};
      for (const [id, p] of Object.entries(json.prices ?? {})) {
        if (!(p.usd ?? 0) && !(p.eur ?? 0)) continue;
        const e: PriceEntry = { usd: p.usd ?? 0, pricedAt: p.pricedAt };
        if (p.eur !== undefined) e.eur = p.eur;
        entries[priceKey(id, 'nonfoil')] = e;
      }
      const stamp = Date.now();
      batch.forEach((id) => attempted.set(id, stamp));
      setPrices(entries);
    } catch {
      cooldownUntil = Date.now() + DECK_PRICE_COOLDOWN_MS;
      return;
    } finally {
      batch.forEach((id) => inFlight.delete(id));
    }
  }
}
