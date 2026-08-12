import type { ListDef } from '../types';
import type { FriendCard } from './cube/pool';
import type { FriendWant } from './friends-client';
import type { OwnedTradeLine } from './trade-picker';
import { isTrackingList } from './lists';

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
 *
 * Tracking lists (catalogues of cards the viewer already owns) are skipped —
 * their entries are not wants, so a friend owning the same card is not a
 * trade opportunity.
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
    if (isTrackingList(list)) continue;
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

/** One card the viewer owns that a friend is looking for — the inverse radar. */
export interface WantMatch {
  /** Canonical name from the viewer's OWN copy (their printing's casing). */
  name: string;
  /** Empty for a legacy copy with no oracleId, matched by name instead. */
  oracleId: string;
  /** Physical copies the viewer holds. Proxies never count — see below. */
  owned: number;
  /**
   * Copies free to trade: unallocated, past the one kept copy, basics excluded
   * (`computeSurplusByName`). 0 means every copy is committed to a deck or
   * cube — still a real match, just not a painless one. This is what turns the
   * section from "they want this" into "they want this and you can safely
   * part with it".
   */
  spare: number;
}

/**
 * The mirror of {@link buildTradeRadar}: their wants × the viewer's collection.
 * Pure.
 *
 * ⚠️ Not the same function with the arguments swapped, and reusing
 * `buildTradeRadar` here was tried and rejected. Its output is built around a
 * want *list entry* — quantity, which of the viewer's lists asked for it, a
 * target price — and every one of those is deliberately stripped from a
 * friend's wants before they leave the server. Feeding it a synthetic
 * single-entry `ListDef` would produce a `TradeRadarMatch` whose `quantity: 1`
 * and `listNames: ['…']` are fabrications, and would still not answer the
 * question this section exists for (can I spare it?). Same indexing idea,
 * different answer.
 *
 * Takes `OwnedTradeLine[]` from `groupOwnedForTrade` rather than a raw
 * collection so the "is it tradeable at all?" rules live in exactly one place:
 * that grouping already drops proxies (a proxy is not the card) and stacks
 * printings under one oracle identity.
 *
 * Matching is by `oracleId`, falling back to a case-insensitive name match for
 * legacy entries on either side. Sorted spare-first, then by name: the cards
 * the viewer can hand over without breaking a deck are the actionable ones.
 */
export function buildWantRadar(
  wants: FriendWant[],
  ownedLines: OwnedTradeLine[],
  surplusByName: Map<string, number>
): WantMatch[] {
  const byOracle = new Map<string, OwnedTradeLine>();
  const byName = new Map<string, OwnedTradeLine>();
  for (const line of ownedLines) {
    if (line.oracleId && !byOracle.has(line.oracleId)) byOracle.set(line.oracleId, line);
    const nameKey = line.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, line);
  }

  const matches = new Map<string, WantMatch>();
  for (const want of wants) {
    const hit =
      (want.oracleId ? byOracle.get(want.oracleId) : undefined) ??
      byName.get(want.name.toLowerCase());
    if (!hit) continue;
    const key = hit.oracleId || hit.name.toLowerCase();
    if (matches.has(key)) continue;
    matches.set(key, {
      name: hit.name,
      oracleId: hit.oracleId,
      owned: hit.copies.length,
      spare: surplusByName.get(hit.name) ?? 0,
    });
  }
  return [...matches.values()].sort(
    (a, b) => Number(b.spare > 0) - Number(a.spare > 0) || a.name.localeCompare(b.name)
  );
}
