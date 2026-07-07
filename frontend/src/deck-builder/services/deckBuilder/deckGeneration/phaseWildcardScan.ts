import type { ScryfallCard, Customization } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import type { GenerationState } from './state';
import { getComboBoosts } from './state';
import { pickFromPrefetchedWithCurve } from '../cardPicking';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';

export interface WildcardScanContext {
  /** Whether land-count auto-tune raised the land count past baseline (32) —
   *  the scan is fully inert (zero cost, empty result) when it didn't. */
  landCountAutoTuned: boolean;
  /** Sizing-anchor land count (typeTargetLandCount) the wildcard budget is
   *  measured against — see deckGenerator.ts's E94 round-2 comment for why
   *  this anchors to the pre-Karsten target rather than the resolved count. */
  typeTargetLandCount: number;
  scryfallCardMap: Map<string, ScryfallCard>;
  budgetTracker: BudgetTracker | null;
  bracketGuard: BracketGuard | undefined;
  isCardAllowedBySynergyDependencies: (card: ScryfallCard) => boolean;
  liftTieBreak: Map<string, number>;
  resolvePriceSanity: (
    customization: Pick<Customization, 'priceSanity' | 'budgetOption'>
  ) => boolean;
  isOverRoleCap: (
    card: ScryfallCard,
    roleTargets: Record<RoleKey, number> | null,
    currentRoleCounts: Record<RoleKey, number>
  ) => boolean;
  roleTargets: Record<RoleKey, number> | null;
}

export interface WildcardScanResult {
  wildcardCount: number;
  wildcardCandidates: ScryfallCard[];
}

// ── Superset-pick wildcard candidates (E82 attempt 6) ──
// Verbatim extraction from generateDeckInner. See phaseLandSqueezeReconcile.ts's
// header for the full mechanism. Pulls every leftover EDHREC-pool card that
// already clears every pick-time gate (the same pickFromPrefetchedWithCurve
// every type pass above uses), for the reconcile to re-rank by its own
// survival score and fold into ONE combined cut alongside the existing
// incumbents. Gated on wildcardCount so this is fully inert — empty array,
// zero scan cost — for every non-auto-tuned generation and any auto-tuned
// deck that lands exactly at the 32-land floor.
export function wildcardScanPhase(
  state: GenerationState,
  ctx: WildcardScanContext
): WildcardScanResult {
  const {
    landCountAutoTuned,
    typeTargetLandCount,
    scryfallCardMap,
    budgetTracker,
    bracketGuard,
    isCardAllowedBySynergyDependencies,
    liftTieBreak,
    resolvePriceSanity,
    isOverRoleCap,
    roleTargets,
  } = ctx;
  const { usedNames, bannedCards, gameChangerCount, currentRoleCounts } = state;
  const { colorIdentity, customization } = state.context;
  const {
    maxCardPrice,
    maxGameChangers,
    maxRarity,
    maxCmc,
    currency,
    arenaOnly,
    collectionStrategy,
    collectionOwnedPercent,
    ignoreOwnedBudget,
    ignoreOwnedRarity,
  } = state.cfg;

  const wildcardCount = landCountAutoTuned ? Math.max(0, typeTargetLandCount - 32) : 0;
  let wildcardCandidates: ScryfallCard[] = [];
  if (wildcardCount > 0) {
    const wildcardPool = state.edhrecData?.cardlists.allNonLand ?? [];
    // Scratch clones: this scan pulls EVERY leftover card that clears the
    // pick gates (not just the K we end up keeping), so it must not leak
    // state into the real generation-wide counters for the — usually
    // large — majority of candidates the reconcile doesn't keep. Role cap
    // is the one gate handled AFTER the scan instead of inside it (see
    // isOverRoleCap below): this call site has no pre-built cardRoleMap
    // (that map is scoped to the EDHREC-pool branch above, out of reach
    // here), and passing `count = pool.length` would otherwise trip the
    // picker's own role-cap escape hatch (built for "never ship a quota
    // short," not for an unbounded scan) on effectively every call.
    const scratchUsedNames = new Set(usedNames);
    const scratchGameChangerCount = { value: gameChangerCount.value };
    const scratchBudgetTracker = budgetTracker?.clone() ?? null;
    const scratchBracketGuard = bracketGuard?.clone();
    // Wide-open curve — this pass has no curve slot of its own, it's a flat
    // marginal scan re-ranked by phaseLandSqueezeReconcile's own scoreOf,
    // not this picker's EDHREC-priority order.
    const wildcardCurveTargets: Record<number, number> = {
      0: 999,
      1: 999,
      2: 999,
      3: 999,
      4: 999,
      5: 999,
      6: 999,
      7: 999,
    };
    const rawWildcardCandidates = pickFromPrefetchedWithCurve(
      wildcardPool,
      scryfallCardMap,
      wildcardPool.length,
      scratchUsedNames,
      colorIdentity,
      wildcardCurveTargets,
      {},
      bannedCards,
      undefined,
      maxCardPrice,
      maxGameChangers,
      scratchGameChangerCount,
      maxRarity,
      maxCmc,
      scratchBudgetTracker,
      state.context.collectionNames,
      getComboBoosts(state),
      currency,
      state.gameChangerNames,
      arenaOnly,
      false,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      scratchBracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      undefined,
      resolvePriceSanity(customization),
      getComboBoosts(state)
    );
    // Hard role cap: same shape as isOverRoleCap's other two callers above
    // — a direct validateCardRole check against the real, current
    // currentRoleCounts, applied post-hoc instead of threading a
    // RoleCapConfig through the throwaway scan above.
    wildcardCandidates = rawWildcardCandidates.filter(
      (c) => !isOverRoleCap(c, roleTargets, currentRoleCounts)
    );
  }

  return { wildcardCount, wildcardCandidates };
}
