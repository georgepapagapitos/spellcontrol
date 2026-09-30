/**
 * How the owned-share repair orders the unowned cards it may evict (E509
 * salvage). EDHREC keys most double-faced cards by the front face (E490): the
 * page lists "Fable of the Mirror-Breaker" while the deck holds "Fable of the
 * Mirror-Breaker // Reflection of Kiki-Jiki". Looked up by the full name the
 * card read as unlisted (-1) and was the first eviction victim, whatever its
 * real inclusion.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { getByCardName } from '@/lib/cards/card-text';
import {
  isProtectionPiece,
  isFreeInteraction,
  isOneSidedWipe,
  getCardTags,
  validateCardRole,
} from '@/deck-builder/services/tagger/client';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { nonboFindings } from './nonbo';
import { STAPLE_INCLUSION_BAR } from './cardPicking';
import type { GenerationState } from './deckGeneration/state';
import { achievableComboPieces } from './deckGeneration/comboLines';
import { STAPLE_ROCK_NAMES } from './deckGeneration/phaseStapleManaRocks';

/** A card's page inclusion by name, the front face for a double-faced card
 *  (getByCardName's rule); -1 when the page doesn't list it. */
export function pageInclusionOf(
  inclusionByName: ReadonlyMap<string, number>
): (name: string) => number {
  return (name) => getByCardName(inclusionByName, name) ?? -1;
}

/** The cards least played on the page first: the owned share's eviction order. */
export function weakestFirst<T extends { name: string }>(
  cards: readonly T[],
  inclusionOf: (name: string) => number
): T[] {
  return [...cards].sort((a, b) => inclusionOf(a.name) - inclusionOf(b.name));
}

/**
 * The owned-share swap's protection (E537, E532 lesson). Below a 100% share it
 * never takes the slot of a must-include, a staple rock, a staple (page
 * inclusion at STAPLE_INCLUSION_BAR), a piece of a combo line the deck can
 * assemble, or a protection / free-interaction piece: the victim is the
 * least-played unowned card that is none of those, and when every unowned card
 * is one of them the share stays short (the owned-share gap note says so). At
 * 100% the share is the user's rule and only must-includes hold.
 */
export function shareKeeper(
  state: Pick<GenerationState, 'combos' | 'usedNames' | 'comboCardNames' | 'cfg' | 'edhrecData'>
): (victim: ScryfallCard, candidate?: ScryfallCard) => boolean {
  const ownedPercent = state.cfg.collectionOwnedPercent;
  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const inclusionOf = pageInclusionOf(new Map(pool.map((c) => [c.name, c.inclusion])));
  const comboPieces = achievableComboPieces(state.combos, pool, (n) => state.usedNames.has(n));
  return (card, candidate) =>
    !!card.isMustInclude ||
    (ownedPercent < 100 &&
      (STAPLE_ROCK_NAMES.has(card.name) ||
        inclusionOf(card.name) >= STAPLE_INCLUSION_BAR ||
        comboPieces.has(card.name) ||
        state.comboCardNames.has(card.name) ||
        isProtectionPiece(card) ||
        getCardTags(card.name).includes('protection') ||
        isFreeInteraction(card) ||
        // E112: a one-sided wipe is not traded for a symmetric one.
        (!!candidate &&
          validateCardRole(candidate) === 'boardwipe' &&
          isOneSidedWipe(card) &&
          !isOneSidedWipe(candidate))));
}

/**
 * An owned card the deck's own coherence audit would flag as a nonbo (E80: it
 * opposes an axis the deck is invested in) is not seated as a stand-in.
 */
export function seatsAsNonbo(
  card: ScryfallCard,
  state: Pick<GenerationState, 'categories' | 'context'>
): boolean {
  const { commander, partnerCommander } = state.context;
  const deck = Object.entries(state.categories)
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards);
  const commanders = [commander, partnerCommander].filter((c): c is ScryfallCard => !!c);
  const invested = new Set(analyzeDeckSynergy([...commanders, ...deck]).invested);
  return nonboFindings([card], invested).length > 0;
}
