// E563: what a combo-completion or repair cut may never take, beyond a
// protection piece. E532 made a staple (STAPLE_INCLUSION_BAR% or more of the
// commander's decks), a staple rock and a combo-line piece untouchable by the
// type passes and E537 made them untouchable to the owned-share swap; the
// combo audit, the combo floor, the coherence repair and bracket convergence
// still cut the lowest-inclusion card whatever it was. Once Solitary
// Confinement read as protection the audit's lowest unprotected card in Sythis
// partial50 was Enlightened Tutor (40.3%, a Game Changer): the cut that
// completes Siona fell on the deck's tutor.
//
// If every card left is kept, the cut doesn't happen and the combo stays
// one-away (the E532 pattern).
import { getByCardName } from '@/lib/cards/card-text';
import { getCardDrawSubtype } from '@/deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import { achievableComboPieces } from './comboLines';
import type { GenerationState } from './state';

/**
 * Whether a card is kept from a repair's cut: a staple, a tutor, a Game
 * Changer (unless the card coming in is one), or a piece of a combo line the
 * deck can assemble. `incoming` is the card the cut makes room for, when known.
 */
export function evictionKeeper(
  state: Pick<GenerationState, 'edhrecData' | 'combos' | 'usedNames' | 'gameChangerNames'>
): (card: ScryfallCard, incomingName?: string) => boolean {
  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const inclusion = new Map(pool.map((c) => [c.name, c.inclusion]));
  const comboPieces = achievableComboPieces(state.combos, pool, (n) => state.usedNames.has(n));
  return (card, incomingName) =>
    (getByCardName(inclusion, card.name) ?? 0) >= STAPLE_INCLUSION_BAR ||
    getCardDrawSubtype(card.name) === 'tutor' ||
    comboPieces.has(card.name) ||
    (state.gameChangerNames.has(card.name) &&
      !(incomingName !== undefined && state.gameChangerNames.has(incomingName)));
}
