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
import {
  getCardDrawSubtype,
  isFreeInteraction,
  readsAsProtection,
} from '@/deck-builder/services/tagger/client';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import { answerClassesOf } from '../deckObjective/classFloors';
import { achievableComboPieces } from './comboLines';
import type { GenerationState } from './state';

/**
 * `keeps(card)` is whether the card is kept. `keeps(card, incoming)` is
 * whether the card is kept AGAINST that incoming card: a kept card leaves for
 * a card at least as strong (E513's trust-region rule, "leaves only for a card
 * played as often"), so the keeper blocks downgrades only. The incoming card
 * is at least as strong when it is itself kept (a tutor, a piece of a line the
 * deck can assemble, a protection or free-interaction piece), or its
 * inclusion is at least the leaving card's, or it answers the same last class
 * the leaving card answers (and the leaving card is kept for nothing else).
 * A blocked incoming card is recorded in `state.keeperBlocked`.
 */
export function evictionKeeper(
  state: Pick<GenerationState, 'edhrecData' | 'combos' | 'categories'> &
    Partial<Pick<GenerationState, 'keeperBlocked'>>
): (card: ScryfallCard, incoming?: ScryfallCard) => boolean {
  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const inclusion = new Map(pool.map((c) => [c.name, c.inclusion]));
  const inclusionOf = (name: string) => getByCardName(inclusion, name) ?? 0;
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

  const isKeptKind = (card: ScryfallCard): boolean =>
    getCardDrawSubtype(card.name) === 'tutor' ||
    comboPieces.has(card.name) ||
    readsAsProtection(card) ||
    isFreeInteraction(card);

  return (card, incoming) => {
    refresh();
    const staple = inclusionOf(card.name) >= STAPLE_INCLUSION_BAR;
    const tutorOrLine = getCardDrawSubtype(card.name) === 'tutor' || comboPieces.has(card.name);
    const lastClasses = answerClassesOf(card).filter((cls) => (classCounts.get(cls) ?? 0) <= 1);
    if (!staple && !tutorOrLine && lastClasses.length === 0) return false;
    if (!incoming) return true;
    const incomingClasses = answerClassesOf(incoming);
    const covers = lastClasses.every((cls) => incomingClasses.includes(cls));
    // A piece of a line leaves only for another kept card: inclusion says nothing
    // about a line (Leyline of Abundance, 5.7%, is the engine of Lathril's infinite).
    const asStrong =
      isKeptKind(incoming) ||
      (!comboPieces.has(card.name) && inclusionOf(incoming.name) >= inclusionOf(card.name));
    if (asStrong || (!staple && !tutorOrLine && covers)) return false;
    state.keeperBlocked?.add(incoming.name);
    return true;
  };
}
