import { copiesByValue, type OwnedTradeLine } from './trade-picker';
import { MAX_TRADE_LINES_PER_SIDE, type TradeCard } from './trades-client';

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
