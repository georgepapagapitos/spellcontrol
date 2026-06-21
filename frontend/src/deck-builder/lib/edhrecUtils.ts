import type { EDHRECCard } from '@/deck-builder/types';

/**
 * Extract the best available USD price string from an EDHRECCard.
 * Prefers TCGPlayer, falls back to Card Kingdom. Returns undefined when
 * neither source carries a price.
 */
export function getEdhrecCardPrice(card: EDHRECCard): string | undefined {
  if (card.prices?.tcgplayer?.price) return card.prices.tcgplayer.price.toFixed(2);
  if (card.prices?.cardkingdom?.price) return card.prices.cardkingdom.price.toFixed(2);
  return undefined;
}

const WUBRG = 'WUBRG';

/**
 * Sort a color array in WUBRG order.
 * Pass `excludeC: true` to filter out colorless ('C') before sorting
 * (needed for EDHREC slug generation, which treats 'C' as a special key).
 */
export function sortWUBRG(colors: string[], excludeC = false): string[] {
  const filtered = excludeC ? colors.filter((c) => c !== 'C') : [...colors];
  return filtered.sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}
