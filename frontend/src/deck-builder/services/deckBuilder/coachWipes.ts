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
import { isExtraCombatPiece, isOneSidedWipe } from '@/deck-builder/services/tagger/client';
import type { CommanderProfile } from './commanderProfile';
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
  const attackTrigger =
    commanders.some((c) => isExtraCombatPiece(c)) ||
    profile.abilities.some((a) => a.keyword === 'attack-trigger');
  return isBoardCentricPlan(
    profile.primaryArchetype,
    { creature: creatures, other: nonLand.length - creatures },
    attackTrigger
  );
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
