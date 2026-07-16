import type { ListDef } from '../types';
import type { FriendCard } from './cube/pool';

/** One want-list card a friend's collection can supply. */
export interface TradeRadarMatch {
  /** Canonical name from the friend's copy (Scryfall casing). */
  name: string;
  /** Total copies wanted across the viewer's lists. */
  quantity: number;
  /** Names of the viewer's lists that want it, in list order, deduped. */
  listNames: string[];
  /** Lowest target price set on any matching entry, if any entry has one. */
  targetPrice?: number;
  /** Currency of the winning `targetPrice`, as entered; absent = USD. */
  currency?: 'USD' | 'EUR';
}

/**
 * Intersects the viewer's want lists with a friend's oracle-deduped collection
 * (the same `fetchFriendCollection` payload the cube collab pool uses). Pure.
 *
 * Matching is by `oracleId` when the entry carries one (printing-agnostic,
 * same identity the "you own N" count uses), falling back to a
 * case-insensitive exact name match for legacy entries without one. One match
 * per distinct card, aggregated across lists; sorted by name.
 */
export function buildTradeRadar(lists: ListDef[], friendCards: FriendCard[]): TradeRadarMatch[] {
  const byOracle = new Map<string, FriendCard>();
  const byName = new Map<string, FriendCard>();
  for (const fc of friendCards) {
    if (fc.oracleId && !byOracle.has(fc.oracleId)) byOracle.set(fc.oracleId, fc);
    const nameKey = fc.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, fc);
  }

  const matches = new Map<string, TradeRadarMatch>();
  for (const list of lists) {
    for (const entry of list.entries) {
      const hit =
        (entry.oracleId ? byOracle.get(entry.oracleId) : undefined) ??
        byName.get(entry.name.toLowerCase());
      if (!hit) continue;
      const key = hit.oracleId || hit.name.toLowerCase();
      const qty = Math.max(1, Math.floor(entry.quantity) || 1);
      const existing = matches.get(key);
      if (existing) {
        existing.quantity += qty;
        if (!existing.listNames.includes(list.name)) existing.listNames.push(list.name);
        if (
          entry.targetPrice !== undefined &&
          (existing.targetPrice === undefined || entry.targetPrice < existing.targetPrice)
        ) {
          existing.targetPrice = entry.targetPrice;
          existing.currency = entry.currency;
        }
      } else {
        matches.set(key, {
          name: hit.name,
          quantity: qty,
          listNames: [list.name],
          targetPrice: entry.targetPrice,
          currency: entry.targetPrice !== undefined ? entry.currency : undefined,
        });
      }
    }
  }
  return [...matches.values()].sort((a, b) => a.name.localeCompare(b.name));
}
