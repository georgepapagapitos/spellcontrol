// E563: what a repair or an eviction phase may never take, beyond a protection
// piece. E532 made a staple (STAPLE_INCLUSION_BAR% or more of the commander's
// decks), a staple rock and a combo-line piece untouchable by the type passes,
// and E537 made them untouchable to the owned-share swap; the combo audit,
// combo floor, coherence repair, bracket convergence and the later eviction
// phases still cut the lowest-ranked card whatever it was. Once Solitary
// Confinement read as protection the audit's lowest unprotected card in Sythis
// partial50 was Enlightened Tutor (40.3%): the cut that completed Siona fell
// on the deck's tutor.
//
// Kept: a staple, a tutor, a piece of a combo line the deck can assemble, and
// the last card of an answer class the deck holds (the answer-coverage
// matrix's classes, deckObjective/classFloors.ts). A Game Changer is not kept
// as such: that rule belongs to the E513 search's trust region, and holding a
// 15% Game Changer moved the repair's cut onto Atraxa's only stack answer.
//
// The combo set and the class counts are read from the deck as it is on every
// call: a coherence repair can seat a piece that a later phase must protect.
//
// If every card left is kept, the cut doesn't happen and the combo stays
// one-away (the E532 pattern).
import { getByCardName } from '@/lib/cards/card-text';
import { getCardDrawSubtype } from '@/deck-builder/services/tagger/client';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import { answerClassesOf } from '../deckObjective/classFloors';
import { achievableComboPieces } from './comboLines';
import type { GenerationState } from './state';

export function evictionKeeper(
  state: Pick<GenerationState, 'edhrecData' | 'combos' | 'categories'>
): (card: ScryfallCard) => boolean {
  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const inclusion = new Map(pool.map((c) => [c.name, c.inclusion]));
  let signature = '';
  let comboPieces = new Set<string>();
  let classCounts = new Map<string, number>();

  // Recomputed when the deck's contents change (a swap keeps the card count).
  const refresh = () => {
    const held = Object.values(state.categories ?? {}).flat();
    const names = held
      .map((c) => c.name)
      .sort()
      .join('|');
    if (names === signature) return;
    signature = names;
    const inDeck = new Set(held.map((c) => c.name));
    // A piece seated from outside the page pool is still a piece of the line.
    const seated = held.map((c) => ({ name: c.name }) as EDHRECCard);
    comboPieces = achievableComboPieces(state.combos ?? [], [...pool, ...seated], (n) =>
      inDeck.has(n)
    );
    classCounts = new Map();
    for (const [cat, cards] of Object.entries(state.categories ?? {})) {
      if (cat === 'lands') continue;
      for (const c of cards)
        for (const cls of answerClassesOf(c)) classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
  };

  return (card) => {
    if ((getByCardName(inclusion, card.name) ?? 0) >= STAPLE_INCLUSION_BAR) return true;
    if (getCardDrawSubtype(card.name) === 'tutor') return true;
    refresh();
    if (comboPieces.has(card.name)) return true;
    return answerClassesOf(card).some((cls) => (classCounts.get(cls) ?? 0) <= 1);
  };
}
