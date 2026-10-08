import type { EnrichedCard } from '../../types';
import {
  copiesByValue,
  groupByPrinting,
  sumCopyValue,
  toRequestedCard,
  toTradeCardFromCopies,
  type OwnedTradeLine,
} from './trade-picker';
import { MAX_TRADE_LINES_PER_SIDE, type TradeCard } from './trades-client';

/** The server's per-line ceiling: at most this many copies of one card. */
export const MAX_COPIES_PER_LINE = 20;

/** Selected quantity, keyed by oracleId (or a name key for legacy copies). */
export type Picked = Record<string, number>;

/**
 * The GIVE side is keyed by card, but its value is the list of `copyId`s the
 * owner actually chose — not a count. Seven printings of one card are seven
 * different objects at seven different prices; a quantity can't say which is
 * leaving the binder, and the old quantity-only model silently sent whichever
 * sorted first. `copyId` never reaches the wire (see toTradeCardFromCopies).
 */
export type PickedCopies = Record<string, string[]>;

export function keyOf(card: { oracleId: string; name: string }): string {
  return card.oracleId || `name:${card.name.toLowerCase()}`;
}

/**
 * Would adding `key` push a basket past the server's 40-lines-per-side cap?
 * Bumping a card already in the basket is never capped — the cap is on
 * distinct lines, not copies (copies have their own per-line ceiling of 20).
 */
export function atLineCap(picked: Record<string, unknown>, key: string): boolean {
  return !(key in picked) && Object.keys(picked).length >= MAX_TRADE_LINES_PER_SIDE;
}

/**
 * Resolves a prefilled give side (a counter's "You give") to the owner's own
 * copies, cheapest first, up to each card's quantity. A card owned short of
 * what was asked is named in `skipped`, so the composer can say so.
 */
export function resolveGivePrefill(
  initialGive: readonly TradeCard[] | undefined,
  ownedByKey: ReadonlyMap<string, OwnedTradeLine>
): { prefill: PickedCopies; skipped: string[] } {
  const prefill: PickedCopies = {};
  const skipped: string[] = [];
  for (const card of initialGive ?? []) {
    const line = ownedByKey.get(keyOf(card));
    const copies = line ? copiesByValue(line) : [];
    const taken = copies.slice(0, card.quantity);
    if (taken.length > 0) prefill[keyOf(card)] = taken.map((c) => c.copyId);
    if (taken.length < card.quantity) skipped.push(card.name);
  }
  return { prefill, skipped };
}

/**
 * Picking a card from the results adds its CHEAPEST unchosen copy — the same
 * safe default `copiesByValue` documents. Returns `prev` untouched when every
 * copy is already in. The line cap is the caller's to check (`atLineCap`).
 */
export function addCheapestCopy(prev: PickedCopies, line: OwnedTradeLine): PickedCopies {
  const key = keyOf(line);
  const chosen = new Set(prev[key] ?? []);
  const next = copiesByValue(line).find((c) => !chosen.has(c.copyId));
  if (!next) return prev;
  return { ...prev, [key]: [...chosen, next.copyId] };
}

/**
 * Set how many copies OF ONE PRINTING are in the trade. Selection is stored as
 * copyIds — the wire shape and settlement both work in printings, and identical
 * copies are interchangeable — so this swaps in the first `count` of that group
 * and leaves every other printing's picks alone. An unknown printing is a no-op.
 */
export function setPrintingCount(
  prev: PickedCopies,
  line: OwnedTradeLine,
  printingKey: string,
  count: number
): PickedCopies {
  const key = keyOf(line);
  const group = groupByPrinting(line).find((g) => g.key === printingKey);
  if (!group) return prev;
  const groupIds = new Set(group.copies.map((c) => c.copyId));
  const kept = (prev[key] ?? []).filter((id) => !groupIds.has(id));
  const added = group.copies.slice(0, Math.max(0, Math.min(count, group.copies.length)));
  const next = [...kept, ...added.map((c) => c.copyId)];
  if (next.length === 0) return removeKey(prev, key);
  return { ...prev, [key]: next };
}

/** Drop one line from a basket without mutating it. */
export function removeKey<T>(prev: Record<string, T>, key: string): Record<string, T> {
  const next = { ...prev };
  delete next[key];
  return next;
}

/** Move a quantity by `delta`, clamped to `max`; at or below zero the line goes. */
export function bump(prev: Picked, key: string, delta: number, max: number): Picked {
  const next = { ...prev };
  const value = (next[key] ?? 0) + delta;
  if (value <= 0) delete next[key];
  else next[key] = Math.min(value, max);
  return next;
}

/** The chosen copies per picked line, resolved against what is owned NOW —
 *  a copy edited or deleted elsewhere simply drops out. */
export function resolveChosen(
  giving: PickedCopies,
  ownedByKey: ReadonlyMap<string, OwnedTradeLine>
): Map<string, EnrichedCard[]> {
  const map = new Map<string, EnrichedCard[]>();
  for (const [key, copyIds] of Object.entries(giving)) {
    const line = ownedByKey.get(key);
    if (!line) continue;
    const ids = new Set(copyIds);
    const chosen = line.copies.filter((c) => ids.has(c.copyId));
    if (chosen.length > 0) map.set(key, chosen);
  }
  return map;
}

/** The give side as wire `TradeCard`s (real printings, no copyIds). */
export function giveTradeCards(
  chosenByKey: ReadonlyMap<string, EnrichedCard[]>,
  ownedByKey: ReadonlyMap<string, OwnedTradeLine>
): TradeCard[] {
  return [...chosenByKey.entries()]
    .map(([key, chosen]) => {
      const line = ownedByKey.get(key);
      return line ? toTradeCardFromCopies(line, chosen) : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.quantity > 0);
}

/** The ask side as oracle-level wire `TradeCard`s. A key `lookup` can't name is skipped. */
export function wantTradeCards(
  wanting: Picked,
  lookup: (key: string) => { oracleId: string; name: string } | undefined
): TradeCard[] {
  return Object.entries(wanting)
    .map(([key, qty]) => {
      const card = lookup(key);
      return card ? toRequestedCard(card, qty) : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.quantity > 0);
}

/** Total copies across a side. */
export function totalQuantity(cards: readonly TradeCard[]): number {
  return cards.reduce((n, c) => n + c.quantity, 0);
}

/** Give side is exact: real copies, real printings, already priced. */
export function giveValue(chosenByKey: ReadonlyMap<string, EnrichedCard[]>): number {
  return [...chosenByKey.values()].reduce((sum, c) => sum + sumCopyValue(c), 0);
}

/**
 * Ask side is a FLOOR, not a price: their collection is oracle-level, so the
 * best honest answer is the cheapest printing that exists. Cards with no known
 * floor are counted in `unpriced` rather than folded in as zero.
 */
export function askFloorValue(
  wantCards: readonly TradeCard[],
  floorPrices: ReadonlyMap<string, number | null>
): { value: number; unpriced: number } {
  const value = wantCards.reduce((sum, c) => sum + (floorPrices.get(c.name) ?? 0) * c.quantity, 0);
  const unpriced = wantCards.filter((c) => (floorPrices.get(c.name) ?? null) === null).length;
  return { value, unpriced };
}

/**
 * The owner's lines this friend is looking for, as `keyOf` keys. A want and an
 * owned copy can each lack an oracleId, so the match falls back to a
 * case-insensitive name — but only the owned line's key ever comes back out.
 */
export function wantedKeysOf(
  friendWants: ReadonlyArray<{ oracleId?: string | null; name: string }> | null,
  ownedLines: readonly OwnedTradeLine[]
): Set<string> {
  if (!friendWants || friendWants.length === 0) return new Set<string>();
  const byOracle = new Set<string>();
  const byName = new Set<string>();
  for (const want of friendWants) {
    if (want.oracleId) byOracle.add(want.oracleId);
    byName.add(want.name.toLowerCase());
  }
  const keys = new Set<string>();
  for (const line of ownedLines) {
    if ((line.oracleId && byOracle.has(line.oracleId)) || byName.has(line.name.toLowerCase())) {
      keys.add(keyOf(line));
    }
  }
  return keys;
}

/**
 * Unsearched, the give list leads with what the friend wants, then spare
 * copies; the rest keeps collection order (the sort is stable).
 */
export function rankGiveLines(
  lines: readonly OwnedTradeLine[],
  wantedKeys: ReadonlySet<string>,
  surplusByName: ReadonlyMap<string, unknown>
): OwnedTradeLine[] {
  const rank = (line: OwnedTradeLine) =>
    wantedKeys.has(keyOf(line)) ? 0 : surplusByName.has(line.name) ? 1 : 2;
  return [...lines].sort((a, b) => rank(a) - rank(b));
}
