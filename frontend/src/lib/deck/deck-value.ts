import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { Deck, DeckCard } from '@/store/decks';
import { getCurrency, type Currency } from '@/lib/collection/currency';
import { getPrice } from '@/lib/collection/card-prices';

/**
 * One card's market price in `currency`; 0 when Scryfall has none.
 *
 * A deck card is a frozen Scryfall copy, so its own `prices` are the day it
 * was added. The device price cache (the one the collection is repriced from,
 * keyed by printing id) is read first, on read, so a deck never rewrites its
 * stored rows (no sync churn) and still tracks the market for every printing
 * the device has priced. A printing the cache has never seen, or has no price
 * for, falls back to the frozen copy.
 */
export function priceOf(card: ScryfallCard, currency: Currency): number {
  const live = card.id ? livePrice(card.id, currency) : undefined;
  if (live !== undefined) return live;
  const raw = getCardPrice(card, currency);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function livePrice(id: string, currency: Currency): number | undefined {
  const e = getPrice(id);
  const n = currency === 'EUR' ? e?.eur : e?.usd;
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * A deck's list value: commander(s) plus mainboard at market, in the display
 * currency, proxies included. What a visitor sees (the shared deck hero): the
 * public projection withholds slot fields, so a visitor can't know which cards
 * the owner proxied, and those choices stay private. The owner's own surfaces
 * read {@link ownDeckValue} instead.
 */
export function deckValue(
  deck: Pick<Deck, 'commander' | 'partnerCommander' | 'cards'>,
  currency: Currency = getCurrency()
): number {
  let total = 0;
  if (deck.commander) total += priceOf(deck.commander, currency);
  if (deck.partnerCommander) total += priceOf(deck.partnerCommander, currency);
  for (const dc of deck.cards) total += priceOf(dc.card, currency);
  return total;
}

/** The copy ids of collection copies flagged as proxies (`EnrichedCard.proxy`). */
export function proxyCopyIdsOf(
  collection: readonly { copyId: string; proxy?: boolean }[]
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const c of collection) if (c.proxy) ids.add(c.copyId);
  return ids;
}

/** A slot played with a proxy: marked in the deck, or holding a proxy copy. */
export function isProxySlot(
  slot: Pick<DeckCard, 'proxy' | 'allocatedCopyId'>,
  proxyCopyIds: ReadonlySet<string>
): boolean {
  return !!slot.proxy || (!!slot.allocatedCopyId && proxyCopyIds.has(slot.allocatedCopyId));
}

export interface OwnDeckValue {
  /** Real cards only, owned or not, at market. */
  value: number;
  /** What the proxies would add at market. Left out of `value`. */
  proxied: number;
}

/**
 * The owner's deck value, the ONE definition behind the deck hero, the decks
 * index (and its Value sort), the deck's section subtotals and Compare. Same
 * scope and prices as {@link deckValue}, but a proxy counts 0: a slot marked
 * as one, or a slot or commander seat holding a collection copy flagged as
 * one. A real card counts at market whether it's owned or still to buy, since
 * the deck calls for it. `proxied` is what was left out, so a surface can say
 * so instead of the number looking wrong.
 */
export function ownDeckValue(
  deck: Pick<
    Deck,
    | 'commander'
    | 'partnerCommander'
    | 'cards'
    | 'commanderAllocatedCopyId'
    | 'partnerCommanderAllocatedCopyId'
  >,
  proxyCopyIds: ReadonlySet<string>,
  currency: Currency = getCurrency()
): OwnDeckValue {
  let value = 0;
  let proxied = 0;
  const add = (card: ScryfallCard, proxy: boolean) => {
    const price = priceOf(card, currency);
    if (proxy) proxied += price;
    else value += price;
  };
  const seat = (copyId: string | null | undefined) => !!copyId && proxyCopyIds.has(copyId);
  if (deck.commander) add(deck.commander, seat(deck.commanderAllocatedCopyId));
  if (deck.partnerCommander) add(deck.partnerCommander, seat(deck.partnerCommanderAllocatedCopyId));
  for (const dc of deck.cards) add(dc.card, isProxySlot(dc, proxyCopyIds));
  return { value, proxied };
}
