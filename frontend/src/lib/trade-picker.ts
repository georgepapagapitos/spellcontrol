import type { EnrichedCard } from '../types';
import type { TradeCard, TradeCopy } from './trades-client';

/**
 * Building the "you give" side of an offer.
 *
 * Composing a trade is the mirror of settling one: here we turn a collection
 * into pickable lines and pin down which physical copies are going, so the
 * offer travels with real printings and the friend's binder ends up holding
 * the card that actually changed hands. See trade-settlement.ts for the other
 * half.
 */

/** One card the owner could put into a trade, with every copy they hold. */
export interface OwnedTradeLine {
  oracleId: string;
  name: string;
  /** Every physical copy, newest printing detail intact, in collection order. */
  copies: EnrichedCard[];
}

/**
 * Groups a collection into one line per distinct card.
 *
 * Keyed by `oracleId` so printings of the same card stack into one line —
 * that is how a person thinks about what they'd trade ("my Sol Ring"), and it
 * matches the oracle-level identity the friend-facing collection uses.
 * Copies with no oracleId (legacy rows) fall back to a name key so they stay
 * tradeable rather than vanishing from the picker.
 */
export function groupOwnedForTrade(cards: EnrichedCard[]): OwnedTradeLine[] {
  const byKey = new Map<string, OwnedTradeLine>();
  for (const card of cards) {
    // Proxies are never tradeable — they are not the card.
    if (card.proxy) continue;
    const key = card.oracleId || `name:${card.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.copies.push(card);
    } else {
      byKey.set(key, {
        oracleId: card.oracleId || '',
        name: card.name,
        copies: [card],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Filters grouped lines by a free-text name query. Case- and accent-naive on
 *  purpose — it matches the plain substring behaviour of the collection search
 *  the user just came from. */
export function filterOwnedLines(lines: OwnedTradeLine[], query: string): OwnedTradeLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return lines;
  return lines.filter((l) => l.name.toLowerCase().includes(q));
}

function toCopy(card: EnrichedCard): TradeCopy {
  const copy: TradeCopy = { scryfallId: card.scryfallId, finish: card.finish };
  if (card.condition) copy.condition = card.condition;
  if (card.language) copy.language = card.language;
  return copy;
}

/**
 * Turns a picked line + quantity into the wire shape, naming the exact copies
 * being handed over.
 *
 * Copies are taken in collection order, which is stable and predictable; the
 * owner can see the printing on each one in the composer before sending. Asking
 * for more copies than are owned is clamped rather than rejected — the picker's
 * stepper already caps at `copies.length`, so this is the belt to that braces.
 */
export function toTradeCard(line: OwnedTradeLine, quantity: number): TradeCard {
  const take = Math.max(0, Math.min(quantity, line.copies.length));
  return {
    oracleId: line.oracleId,
    name: line.name,
    quantity: take,
    copies: line.copies.slice(0, take).map(toCopy),
  };
}

/**
 * The "you get" side: what the viewer is asking a friend for. Named
 * oracle-level with no copies, because the friend collection it was picked
 * from carries no printing detail (contents yes, value no) — the friend's own
 * device fills the printings in when they accept.
 */
export function toRequestedCard(
  card: { oracleId: string; name: string },
  quantity: number
): TradeCard {
  return { oracleId: card.oracleId, name: card.name, quantity, copies: [] };
}
