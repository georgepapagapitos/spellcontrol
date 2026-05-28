/**
 * ScryfallCard → opening-hand classification helpers.
 *
 * `opening-hand-sim.ts` is deliberately decoupled from `ScryfallCard` (it works
 * on the minimal `SimCard` shape). This module is the bridge: it reduces a full
 * card to a `SimCard` so both the deck-view test-hand panel and the playtest
 * opening-hand sheet classify cards the same way — and therefore reach the same
 * keep verdict via `isKeepableHand`.
 */

import { getCardRole } from '@/deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { SimCard } from './opening-hand-sim';

export function isLand(card: ScryfallCard): boolean {
  const tl = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  return tl.toLowerCase().includes('land');
}

export function cardCmc(card: ScryfallCard): number {
  return card.cmc ?? 0;
}

/**
 * Reduce a full card to the minimal shape the opening-hand heuristics need.
 * `role` is null when tagger data isn't loaded — the keep verdict still works
 * (it just won't credit ramp), so callers don't need tagger data on hand.
 */
export function toSimCard(card: ScryfallCard): SimCard {
  return {
    isLand: isLand(card),
    cmc: cardCmc(card),
    role: getCardRole(card.name),
    colors: card.color_identity ?? [],
  };
}
