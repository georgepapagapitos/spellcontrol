/**
 * The whole-deck objective for a saved deck on the deck page: the Cuts lane's
 * pairing (use-cut-swaps.ts) and the plans' judge (use-plan-judge.ts) both
 * build it from the same sources, so a card is judged by one rule everywhere.
 */
import type { ComboMatchResponse } from '@/types/combos';
import type { Deck } from '@/store/decks';
import { getGameChangerNames } from '@/deck-builder/services/scryfall/client';
import { coachCombos, loadCoachObjective, protectionSourcesFrom } from './coach-objective';
import type { CoachObjectiveResult } from './coach-objective';

export interface CutSwapSources {
  deck: Deck;
  /** The mainboard-scoped combo answer (`mainboardComboData`). */
  combos: ComboMatchResponse | null | undefined;
  /** The collection (one entry per copy is fine): its names and the colors each card needs. */
  owned: readonly { name: string; colorIdentity?: readonly string[] }[];
}

/** The objective for the sources' deck, or why it can't be scored. */
export async function loadSourcesObjective(src: CutSwapSources): Promise<CoachObjectiveResult> {
  const gameChangerNames = await getGameChangerNames().catch(() => new Set<string>());
  const d = src.deck;
  const ownedNames = new Set(src.owned.map((c) => c.name));
  return loadCoachObjective(d, {
    roleTargets: d.roleTargets,
    combos: coachCombos(
      src.combos,
      d.cards.map((c) => c.card)
    ),
    ownedNames,
    availableNames: ownedNames,
    gameChangerNames,
    protections: protectionSourcesFrom(d),
    knownCards: d.cards.map((c) => c.card),
  });
}
