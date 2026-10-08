/**
 * Cards Coach doesn't suggest to this deck, whatever their play rate (T171
 * round 3).
 *
 * - A card the build removed for a stated reason (`buildReport`'s coherence
 *   repairs, fixup repairs and surplus conversions), while the card it made
 *   room for is still in the deck: the reason still holds. Sythis's build cut
 *   Rest in Peace as an orphan combo piece for Path to Exile, and Coach offered
 *   it straight back as an "EDHREC staple".
 * - Graveyard hate in a deck that recurs from its own graveyard: Rest in Peace
 *   blanks Starfield of Nyx and Resurgent Belief. A deck invested in the
 *   graveyard axis, or running three counted recursion cards, qualifies.
 */
import type { CoherenceRepair, ScryfallCard } from '@/deck-builder/types';
import { countsAsRole, getCardFacts } from '@/deck-builder/services/cardFacts';
import type { DeckSynergy } from '../synergy/deckSynergy';

/** Counted recursion cards that make a deck its own graveyard's user. */
const RECURSION_DECK_MIN = 3;

export interface BuildRemovals {
  coherenceRepairs?: CoherenceRepair[];
  fixupRepairs?: CoherenceRepair[];
  surplusConversions?: CoherenceRepair[];
}

const lower = (name: string) => name.toLowerCase();

/**
 * The cards the build removed whose replacement is still in the deck. A replacement
 * the build itself cut later is followed to what took ITS place (Rest in Peace went
 * for Starfield of Nyx, which went for Auramancer: the reason still holds while
 * Auramancer is in the deck).
 */
export function removedByBuild(
  report: BuildRemovals | undefined,
  cards: readonly ScryfallCard[]
): Set<string> {
  const inDeck = new Set(cards.map((c) => lower(c.name)));
  const repairs = [
    ...(report?.coherenceRepairs ?? []),
    ...(report?.fixupRepairs ?? []),
    ...(report?.surplusConversions ?? []),
  ];
  const tookPlace = new Map<string, string>();
  for (const r of repairs)
    if (!tookPlace.has(lower(r.cut))) tookPlace.set(lower(r.cut), lower(r.added));
  const holds = (added: string): boolean => {
    const seen = new Set<string>();
    for (let n: string | undefined = added; n && !seen.has(n); n = tookPlace.get(n)) {
      if (inDeck.has(n)) return true;
      seen.add(n);
    }
    return false;
  };
  return new Set(
    repairs
      .filter((r) => holds(lower(r.added)) && !inDeck.has(lower(r.cut)))
      .map((r) => lower(r.cut))
  );
}

function hasRole(name: string, role: string): boolean {
  return !!getCardFacts(name)?.roles.some((r) => r.role === role && countsAsRole(r));
}

/** Whether graveyard hate works against this deck's own plan. */
export function recursesOwnGraveyard(
  cards: readonly ScryfallCard[],
  synergy: Pick<DeckSynergy, 'invested'>
): boolean {
  if (synergy.invested.includes('graveyard')) return true;
  return cards.filter((c) => hasRole(c.name, 'recursion')).length >= RECURSION_DECK_MIN;
}

/**
 * The names Coach leaves out of this deck's suggestions: what the build
 * removed for a reason that still holds, graveyard hate when the deck
 * recurs from its own graveyard, and what the player hid with "Not for this
 * deck" (`dismissed`, lowercased names; E580).
 */
export function coachExclusions(
  report: BuildRemovals | undefined,
  cards: readonly ScryfallCard[],
  synergy: Pick<DeckSynergy, 'invested'>,
  dismissed?: ReadonlySet<string>
): (name: string) => boolean {
  const removed = removedByBuild(report, cards);
  const noHate = recursesOwnGraveyard(cards, synergy);
  return (name) =>
    removed.has(lower(name)) ||
    !!dismissed?.has(lower(name)) ||
    (noHate && hasRole(name, 'graveyardHate'));
}

/** Drop the excluded rows from each suggestion list, in place. */
export function dropExcluded<T>(
  list: T[] | undefined,
  nameOf: (row: T) => string,
  excluded: (name: string) => boolean
): void {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) if (excluded(nameOf(list[i]))) list.splice(i, 1);
}
