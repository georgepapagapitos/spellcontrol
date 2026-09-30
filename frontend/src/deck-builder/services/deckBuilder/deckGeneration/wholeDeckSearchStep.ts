// E513: how generateDeck calls the whole-deck search. Kept out of
// deckGenerator.ts, and the phase itself is loaded only when
// customization.wholeDeckSearch asks for it, so a flag-off build neither runs
// nor downloads it. deckGenerator.ts imports it as a namespace
// (wholeDeckSearch.run, .stampProvenance, .reportFields) and calls run after
// the last phase that changes the list, before any note is written.
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import type { WholeDeckSearchInput } from './phaseWholeDeckSearch';
import { refreshComboCompleteness } from './phaseDetectCombos';
import type { GenerationState } from './state';

/** Runs the search when the flag is on, leaves its result on
 *  state.wholeDeckSearch, and returns the combo list for the final deck. */
export async function run(
  state: GenerationState,
  input: WholeDeckSearchInput
): Promise<DetectedCombo[] | undefined> {
  if (!state.context.customization.wholeDeckSearch) return input.detectedCombos;
  const { wholeDeckSearchPhase } = await import('./phaseWholeDeckSearch');
  state.wholeDeckSearch = await wholeDeckSearchPhase(state, input);
  return state.wholeDeckSearch.swaps.length
    ? refreshComboCompleteness(input.detectedCombos, state)
    : input.detectedCombos;
}

/** Labels each card the search brought in that is still in the deck. */
export function stampProvenance(
  state: GenerationState,
  nonLandCards: readonly ScryfallCard[],
  cardProvenance: Record<string, string>
): void {
  for (const swap of state.wholeDeckSearch?.swaps ?? [])
    if (nonLandCards.some((c) => c.name === swap.added))
      cardProvenance[swap.added] = `Swapped in by the whole-deck search for ${swap.cut}`;
}

/** The report's fields for the search: no key at all when it changed nothing,
 *  so a flag-off deck's report is unchanged. */
export function reportFields(state: GenerationState) {
  const search = state.wholeDeckSearch;
  return search?.swaps.length
    ? { wholeDeckSearchSwaps: search.swaps, wholeDeckSearchNote: search.note }
    : {};
}
