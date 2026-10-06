// E513: how generateDeck calls the whole-deck search. Kept out of
// deckGenerator.ts. The search is on unless customization.wholeDeckSearch is
// explicitly false (default on since 2026-10-06); the phase is loaded only
// when it runs, so an opted-out build neither runs nor downloads it. deckGenerator.ts imports it as a namespace
// (wholeDeckSearch.run, .stampProvenance, .reportFields) and calls run after
// the last phase that changes the list, before any note is written.
import type { CoherenceRepair, DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import type { WholeDeckSearchInput } from './phaseWholeDeckSearch';
import { detectCombosPhase, refreshComboCompleteness } from './phaseDetectCombos';
import type { GenerationState } from './state';
import { SEARCH_PROGRESS_MESSAGE, SEARCH_PROGRESS_PERCENT } from './searchProgress';

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

/** The search is on unless a build says false. */
export function searchEnabled(customization: { wholeDeckSearch?: boolean }): boolean {
  return customization.wholeDeckSearch !== false;
}

/** Lets the page paint the step's line before the search holds the thread. */
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

/** Runs the search unless the build opted out, leaves its result on
 *  state.wholeDeckSearch, and returns the combo list for the final deck. */
export async function run(
  state: GenerationState,
  input: WholeDeckSearchInput
): Promise<DetectedCombo[] | undefined> {
  if (!searchEnabled(state.context.customization)) return input.detectedCombos;
  state.context.onProgress?.(SEARCH_PROGRESS_MESSAGE, SEARCH_PROGRESS_PERCENT);
  await paint();
  const { wholeDeckSearchPhase } = await import('./phaseWholeDeckSearch');
  const combos = allDeckCombos(state, input.detectedCombos);
  state.wholeDeckSearch = await wholeDeckSearchPhase(state, {
    ...input,
    timeBudgetMs: state.context.searchTimeBudgetMs ?? input.timeBudgetMs,
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
      cardProvenance[swap.added] = `Swapped in for ${swap.cut} after checking the whole deck`;
}

/** The report's fields for the search: no key at all when it changed nothing. */
export function reportFields(state: GenerationState) {
  const search = state.wholeDeckSearch;
  return search?.swaps.length
    ? { wholeDeckSearchSwaps: search.swaps, wholeDeckSearchNote: search.note }
    : {};
}
