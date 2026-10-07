// E532: the combo lines a deck can assemble from its own pool, for the type
// passes' staple tier (cardPicking.ts's comboLinePieces). A staple may take a
// filler slot, never a slot a piece of one of these lines would have had.
import type { EDHRECCombo, EDHRECCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';

/**
 * The combos generation adds or promotes cards for (E540 S8): only lines that
 * end the game (`comboEndsGame`, E437), the rule Coach follows. A loop that
 * only makes mana or draws cards is a good card's side effect, never a reason
 * to seat or boost its pieces. Pieces already in the deck keep their
 * protection; this only narrows what earns a NEW slot.
 */
export function winCombos<T extends { results: string[] }>(combos: readonly T[]): T[] {
  return combos.filter((c) => comboEndsGame(c.results));
}

/**
 * Every piece of a game-ending EDHREC combo for this commander whose pieces
 * are all in the candidate pool, already in the deck, or a commander. Names are the
 * pool's own spelling (a DFC piece matches by its front face).
 */
export function achievableComboPieces(
  combos: readonly EDHRECCombo[],
  pool: readonly EDHRECCard[],
  inDeck: (name: string) => boolean
): Set<string> {
  const poolNames = new Map<string, string>();
  for (const c of pool) {
    poolNames.set(c.name, c.name);
    poolNames.set(frontFaceName(c.name), c.name);
  }
  const pieces = new Set<string>();
  for (const combo of winCombos(combos)) {
    const names = combo.cards.map((c) => c.name);
    if (!names.every((n) => poolNames.has(n) || inDeck(n))) continue;
    for (const n of names) {
      const own = poolNames.get(n);
      if (own) pieces.add(own);
    }
  }
  return pieces;
}
