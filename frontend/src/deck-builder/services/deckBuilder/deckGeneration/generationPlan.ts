/**
 * Generation's build plan: `resolveBuildPlan` plus the one input the pure plan
 * cannot hold, Karsten's MDFC land term (5.4a). It needs card data, so it is
 * fetched here (only when the auto land count runs) and handed back on the plan
 * for the build report to record, where the analysis of the saved deck reads it.
 */
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { resolveBuildPlan, wantsExtraCombat, type BuildPlanInput } from './buildPlan';
import { expectedMdfcLandTerm } from './mdfcLandTerm';

export { wantsExtraCombat };

export async function resolveGenerationPlan(input: BuildPlanInput & { arenaOnly: boolean }) {
  const mdfcLandTerm = await expectedMdfcLandTerm({
    format: input.format,
    customization: input.customization,
    edhrecData: input.edhrecData,
    fetchCards: (names) =>
      getCardsByNames(names, undefined, undefined, { arenaOnly: input.arenaOnly }),
  });
  return { ...resolveBuildPlan({ ...input, mdfcLandTerm }), mdfcLandTerm };
}
