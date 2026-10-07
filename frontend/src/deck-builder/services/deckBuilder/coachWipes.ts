/**
 * The generator's wipe-asymmetry rule (E109/E112), applied to what Coach
 * suggests (T171 round 3).
 *
 * A deck that builds a board runs fewer wipes and prefers ones that spare its
 * own side. Generation already picks that way; Coach didn't, and suggested
 * Blasphemous Act (13 damage to every creature) to a go-wide Isshin deck.
 * Coach reads the same two predicates the generator does: `isBoardCentricPlan`
 * over the deck's own creature share and the commander's attack trigger, and
 * `isOneSidedWipe` over the card's oracle text.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { isOneSidedWipe } from '@/deck-builder/services/tagger/client';
import type { CommanderProfile } from './commanderProfile';
import { wantsExtraCombat } from './deckGeneration/buildPlan';
import { isBoardCentricPlan } from './roleTargets';

/** Whether this deck, as built, is the kind generation keeps symmetric wipes out of. */
export function prefersOneSidedWipes(
  commanders: readonly ScryfallCard[],
  profile: CommanderProfile,
  cards: readonly ScryfallCard[]
): boolean {
  const nonLand = cards.filter(
    (c) => !/\bland\b/i.test(c.card_faces?.[0]?.type_line ?? c.type_line ?? '')
  );
  const creatures = nonLand.filter((c) =>
    /\bcreature\b/i.test(c.card_faces?.[0]?.type_line ?? c.type_line ?? '')
  ).length;
  return isBoardCentricPlan(
    profile.primaryArchetype,
    { creature: creatures, other: nonLand.length - creatures },
    wantsExtraCombat(commanders, profile)
  );
}

/**
 * The role targets of a deck that builds a board: one fewer board wipe, never below
 * one (a board-centric deck still wants a reset button). Generation shaves its own
 * target the same way (deckGenerator.ts, wipeAsymmetryTargetShaved) and discloses it
 * in the wipe-asymmetry note; the analysis that grades a SAVED deck must read the
 * same target, or a deck generated at "1 of 1 wipes, all roles well-covered" reads
 * "1 of 2, needs more board wipes" the moment Coach grades it (T171 S6: Isshin went
 * A to B on a land swap that changed no role count).
 */
export function shaveWipeTarget<T extends Record<string, number>>(
  targets: T,
  buildsBoard: boolean
): T {
  return buildsBoard && (targets.boardwipe ?? 0) > 1
    ? { ...targets, boardwipe: targets.boardwipe - 1 }
    : targets;
}

/**
 * Remove every symmetric board wipe from the suggestion lists, in place. A
 * row whose card can't be resolved stays: no oracle text, no evidence.
 */
export async function dropSymmetricWipes(
  lists: readonly { name: string; role?: string }[][],
  resolve: (names: string[]) => Promise<Map<string, ScryfallCard>>
): Promise<void> {
  const names = [
    ...new Set(
      lists
        .flat()
        .filter((r) => r.role === 'boardwipe')
        .map((r) => r.name)
    ),
  ];
  if (names.length === 0) return;
  const cards = await resolve(names);
  const symmetric = new Set(
    [...cards.values()].filter((c) => !isOneSidedWipe(c)).map((c) => c.name.toLowerCase())
  );
  for (const list of lists) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (symmetric.has(list[i].name.toLowerCase())) list.splice(i, 1);
    }
  }
}
