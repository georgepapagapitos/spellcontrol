// E1044: the budget last resort. applyBudgetConvergence runs its same-role
// stages before the whole-deck search; this runs its last-resort stages (the
// value cut, then lands) once every pass that can move the total has run, so
// it touches only a deck that is still over budget.
import type { CoherenceRepair, DetectedCombo } from '@/deck-builder/types';
import type { GenerationState } from './state';
import { applyBudgetConvergence, type BudgetConvergeContext } from './phaseBudgetConverge';
import { refreshComboCompleteness } from './phaseDetectCombos';
import * as wholeDeckSearch from './wholeDeckSearchStep';

export interface BudgetTally {
  detectedCombos: DetectedCombo[] | undefined;
  budgetRepairs: CoherenceRepair[];
  budgetConvergedSwaps: number;
  budgetResidualReason: string | undefined;
  /** Swaps the last resort made, at the end of budgetRepairs. */
  lastResortSwaps: number;
}

export async function runBudgetLastResort(
  state: GenerationState,
  ctx: BudgetConvergeContext | null,
  tally: BudgetTally
): Promise<BudgetTally> {
  if (!ctx) return tally; // no budget asked
  const last = await applyBudgetConvergence(state, {
    ...ctx,
    detectedCombos: tally.detectedCombos,
    lastResort: true,
  });
  if (last.applied === 0 && !last.residualReason) return tally;
  // A deck still over says why as of now, not as of the first call.
  if (last.applied === 0) return { ...tally, budgetResidualReason: last.residualReason };
  return {
    detectedCombos: refreshComboCompleteness(tally.detectedCombos, state),
    budgetRepairs: [...tally.budgetRepairs, ...last.repairs],
    budgetConvergedSwaps: tally.budgetConvergedSwaps + last.applied,
    budgetResidualReason: last.residualReason,
    lastResortSwaps: last.applied,
  };
}

/** The substitutions still standing for the budget note. The search can
 *  reverse a same-role swap made before it, never a last-resort one made after. */
export function standingBudgetSwaps(state: GenerationState, tally: BudgetTally): number {
  const { budgetRepairs, budgetConvergedSwaps, lastResortSwaps } = tally;
  return (
    wholeDeckSearch.standing(
      state,
      budgetRepairs.slice(0, budgetRepairs.length - lastResortSwaps),
      budgetConvergedSwaps - lastResortSwaps
    ) + lastResortSwaps
  );
}
