// E513: how generateDeck calls the whole-deck search. Kept out of
// deckGenerator.ts, and the phase itself is loaded only when
// customization.wholeDeckSearch asks for it, so a flag-off build neither runs
// nor downloads it. deckGenerator.ts imports it as a namespace
// (wholeDeckSearch.run, .stampProvenance, .reportFields) and calls run after
// the last phase that changes the list, before any note is written.
import type { CoherenceRepair, DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import type { WholeDeckSearchInput } from './phaseWholeDeckSearch';
import { detectCombosPhase, refreshComboCompleteness } from './phaseDetectCombos';
import type { GenerationState } from './state';

/**
 * Every combo the deck assembles, not only the list the phases before handed
 * on: each of them cuts the list to the lines within two cards of complete as
 * it goes, so a line a later pick completed (Umbral Mantle with four elves)
 * can be missing from it, and the search protects only what it knows. The
 * dataset's own read of the deck now, then whatever the list held besides.
 */
function allDeckCombos(
  state: GenerationState,
  handed: DetectedCombo[] | undefined
): DetectedCombo[] | undefined {
  const fresh = detectCombosPhase(state) ?? [];
  const known = new Set(fresh.map((c) => c.comboId));
  const all = [...fresh, ...(handed ?? []).filter((c) => !known.has(c.comboId))];
  return all.length > 0 ? all : undefined;
}

/** Runs the search when the flag is on, leaves its result on
 *  state.wholeDeckSearch, and returns the combo list for the final deck. */
export async function run(
  state: GenerationState,
  input: WholeDeckSearchInput
): Promise<DetectedCombo[] | undefined> {
  if (!state.context.customization.wholeDeckSearch) return input.detectedCombos;
  const { wholeDeckSearchPhase } = await import('./phaseWholeDeckSearch');
  const combos = allDeckCombos(state, input.detectedCombos);
  state.wholeDeckSearch = await wholeDeckSearchPhase(state, {
    ...input,
    detectedCombos: combos,
    surplusCuts: state.surplusCuts,
  });
  return state.wholeDeckSearch.swaps.length
    ? refreshComboCompleteness(combos, state)
    : input.detectedCombos;
}

/**
 * The budget substitutions still standing after the search: the count the
 * budget note states, less the repairs the search reversed (a card a repair
 * added cut again, or a card it cut put back). Unchanged when the search made
 * no swap.
 */
export function standing(
  state: GenerationState,
  repairs: readonly CoherenceRepair[],
  applied: number
): number {
  const swaps = state.wholeDeckSearch?.swaps ?? [];
  const reversed = repairs.filter((r) =>
    swaps.some((s) => s.cut === r.added || s.added === r.cut)
  ).length;
  return Math.max(0, applied - reversed);
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
