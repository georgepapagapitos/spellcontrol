/**
 * How the owned-share repair orders the unowned cards it may evict (E509
 * salvage). EDHREC keys most double-faced cards by the front face (E490): the
 * page lists "Fable of the Mirror-Breaker" while the deck holds "Fable of the
 * Mirror-Breaker // Reflection of Kiki-Jiki". Looked up by the full name the
 * card read as unlisted (-1) and was the first eviction victim, whatever its
 * real inclusion.
 */
import { getByCardName } from '@/lib/cards/card-text';
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
 * E537: the owned-share swap never takes a slot from a must-include, nor from a
 * staple rock below a 100% share (Sol Ring and Arcane Signet stay, owned or
 * not). At 100% the share is the user's rule and an unowned rock may go.
 */
export function keepsOwnedShareSlot(
  card: { name: string; isMustInclude?: boolean },
  ownedPercent: number
): boolean {
  return !!card.isMustInclude || (ownedPercent < 100 && STAPLE_ROCK_NAMES.has(card.name));
}
