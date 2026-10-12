import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { Deck } from '@/store/decks';
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
 * A deck's value: commander(s) plus mainboard, in the display currency.
 * The ONE definition behind the decks index, the owner's deck hero and the
 * shared deck hero, so the same deck reads the same number everywhere. Each
 * surface used to sum its own: two priced in USD whatever the currency, and
 * the shared hero left the commander out.
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
