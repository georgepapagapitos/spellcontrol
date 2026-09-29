/**
 * Price-target crossing detection (T117): compares each want-list entry that
 * has a `targetPrice` against its own printing's live market price (the
 * entry's own `scryfallId`/`finish` — same per-copy key `card-prices.ts`
 * already uses) and reports which are currently at or under target. Fired
 * from the client-side price-refresh tick (`store/collection.ts`) — there is
 * deliberately no server price cron (see `project_price_refresh`).
 *
 * The "already alerted" bookkeeping is device-local, like the price cache
 * itself (`card-prices.ts`) and value-history: never synced.
 */
import type { ListDef, ListEntry } from '@/types/index';
import { isTrackingList } from './lists';
import { getPrice } from './card-prices';

export interface PriceTargetHit {
  entryId: string;
  name: string;
  listId: string;
  listName: string;
  /** Live price, in the SAME currency `targetPrice` was entered in — never
   *  cross-currency compared (see `ListEntry.currency`). */
  price: number;
  targetPrice: number;
  currency: 'USD' | 'EUR';
}

/** The live price for one entry's own printing, in whichever currency its
 *  `targetPrice` was entered in. `undefined` when that currency's price has
 *  never been fetched for this printing — never treated as a $0 hit. */
function defaultPriceFor(entry: ListEntry): number | undefined {
  const raw = getPrice(entry.scryfallId, entry.finish);
  if (!raw) return undefined;
  return (entry.currency ?? 'USD') === 'EUR' ? raw.eur : raw.usd;
}

/**
 * Pure: every want-list entry with a `targetPrice` whose live price is
 * currently at or under it. `priceFor` is injectable for tests; defaults to
 * the real device price cache.
 */
export function findPriceTargetHits(
  lists: readonly ListDef[],
  priceFor: (entry: ListEntry) => number | undefined = defaultPriceFor
): PriceTargetHit[] {
  const hits: PriceTargetHit[] = [];
  for (const list of lists) {
    if (isTrackingList(list)) continue;
    if (list.rule) continue; // dynamic list — entries are empty by construction
    for (const entry of list.entries) {
      if (entry.targetPrice === undefined) continue;
      const price = priceFor(entry);
      if (price === undefined || price > entry.targetPrice) continue;
      hits.push({
        entryId: entry.id,
        name: entry.name,
        listId: list.id,
        listName: list.name,
        price,
        targetPrice: entry.targetPrice,
        currency: entry.currency ?? 'USD',
      });
    }
  }
  return hits;
}

const SEEN_KEY = 'spellcontrol:price-target-hits-seen';

function loadSeen(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, number>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* quota / unavailable — once-only bookkeeping is a nicety, never critical */
  }
}

/**
 * Filters `hits` down to ones not already alerted at this exact price on
 * this device (keyed by entry id + price, so a price that drops FURTHER, or
 * rises back above target and dips again, alerts again — but a repeat
 * refresh landing the same price does not). Recording a hit is a side
 * effect of calling this — call once per refresh cycle, right after
 * `findPriceTargetHits`.
 */
export function filterNewPriceTargetHits(hits: PriceTargetHit[]): PriceTargetHit[] {
  const seen = loadSeen();
  const fresh = hits.filter((h) => seen[h.entryId] !== h.price);
  if (fresh.length > 0) {
    for (const h of fresh) seen[h.entryId] = h.price;
    saveSeen(seen);
  }
  return fresh;
}

/** Test-only: reset the device-local once-only bookkeeping. */
export function _resetPriceTargetHitsForTests(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}
