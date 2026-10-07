import type { ScryfallCard } from '@/deck-builder/types';
import {
  getBoardwipeSubtype,
  getCardDrawSubtype,
  getRampSubtype,
  getRemovalSubtype,
} from '@/deck-builder/services/tagger/client';

/**
 * A card's role subtypes: the stamp generation left on it, else the tagger's
 * read by name (a card added later carries no stamp, and the stamp is that same
 * lookup). Reading the tagger either way means a deck grades the same whether
 * or not its cards were stamped (E573: an unstamped generated deck read B on
 * mana sources where the stamped one read A).
 */
export function subtypesOf(card: ScryfallCard) {
  return {
    ramp: card.rampSubtype ?? getRampSubtype(card.name) ?? undefined,
    removal: card.removalSubtype ?? getRemovalSubtype(card.name) ?? undefined,
    boardwipe: card.boardwipeSubtype ?? getBoardwipeSubtype(card.name) ?? undefined,
    cardDraw: card.cardDrawSubtype ?? getCardDrawSubtype(card.name) ?? undefined,
  };
}

/** A ramp subtype that adds mana itself: a dork or a rock. */
export const isManaSource = (ramp: string | undefined) =>
  ramp === 'mana-producer' || ramp === 'mana-rock';
