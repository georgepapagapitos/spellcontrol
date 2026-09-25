import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { Deck } from '../store/decks';
import { getCurrency, type Currency } from './currency';

/** One card's market price in `currency`; 0 when Scryfall has none. */
export function priceOf(card: ScryfallCard, currency: Currency): number {
  const raw = getCardPrice(card, currency);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
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
