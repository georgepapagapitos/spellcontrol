import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';

const NAMED = 4;

/**
 * Disclosure when cards are priced from another printing: the printing the player's set or
 * filter seated has no price, so the budget and the price cap read the cheapest priced
 * printing of the same name (the player can buy any printing). Undefined when none are.
 */
export function buildPrintingPriceNote(
  cards: readonly ScryfallCard[],
  currency: 'USD' | 'EUR' = 'USD'
): string | undefined {
  const borrowed = cards.filter((c) => c.pricedFromSet);
  if (borrowed.length === 0) return undefined;
  const sym = currency === 'EUR' ? '€' : '$';
  const named = borrowed.slice(0, NAMED).map((c) => {
    const p = parseFloat(getCardPrice(c, currency) ?? '');
    return Number.isFinite(p) ? `${c.name} (${sym}${p.toFixed(2)})` : c.name;
  });
  const more = borrowed.length - named.length;
  const count = borrowed.length === 1 ? '1 card has' : `${borrowed.length} cards have`;
  return (
    `${count} no price in the printing your filter chose, so the budget and price cap count ` +
    `${borrowed.length === 1 ? 'it' : 'them'} at the cheapest printing that has one: ` +
    `${named.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`
  );
}
