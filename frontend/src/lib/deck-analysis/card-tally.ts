import type { ScryfallCard } from '@/deck-builder/types';

/** A unique card with how many copies are in the deck — the shape the deck-stat
 *  drill-downs (mana sources, type/curve/color breakdowns) pass to the carousel.
 *  `card` carries the already-loaded Scryfall object so the carousel renders
 *  instantly instead of re-querying Scryfall by name. */
export interface CardTally {
  name: string;
  count: number;
  card?: ScryfallCard;
}
