/**
 * The build's plan: the numbers a deck is built to and graded against.
 *
 * Role targets, the auto land count, pacing and the board-centric wipe shave
 * are one derivation. Generation reads it to build; the analysis of a saved
 * generated deck reads it to grade, so the same deck gets the same targets and
 * the same grade whether it is shown right after generation or analyzed later
 * (E573: 28 of 59 generated decks graded A by generation and B by the
 * analysis, which derived its own land target, pacing and wipe shave).
 *
 * Pure: every input is a plain value, nothing here fetches or mutates.
 */
import type {
  Archetype,
  Customization,
  DeckSize,
  EDHRECCommanderData,
  Pacing,
  RoleTargetBreakdown,
  ScryfallCard,
  ThemeResult,
} from '@/deck-builder/types';
import { isExtraCombatPiece, type RoleKey } from '@/deck-builder/services/tagger/client';
import type { CommanderProfile } from '../commanderProfile';
import { applyArchetypeTypeFloor } from '../curveUtils';
import { getDynamicRoleTargets, isBoardCentricPlan } from '../roleTargets';
import {
  calculateTargetCounts,
  computeAutoLandCount,
  computeLandCountSizingAnchor,
  DEFAULT_LAND_COUNT,
  isDefaultLandCount,
  karstenAppliesToFormat,
  type TargetCountsResult,
} from '../targetCounts';

/** The build settings the plan reads; a saved deck keeps them in `generationContext`. */
export type BuildPlanSettings = Pick<
  Customization,
  'deckFormat' | 'landCount' | 'nonBasicLandCount' | 'tempoAutoDetect' | 'tempoPacing'
>;

/**
 * The commander's payoff is attacking: it makes or wants extra combats, or its
 * own text triggers on attack (`commanderProfile` merges the partner's text).
 * A board-centric plan by definition (`isBoardCentricPlan`).
 */
export function wantsExtraCombat(
  commanders: readonly ScryfallCard[],
  profile: CommanderProfile
): boolean {
  return (
    commanders.some((c) => isExtraCombatPiece(c)) ||
    profile.abilities.some((a) => a.keyword === 'attack-trigger')
  );
}

export interface BuildPlanInput {
  format: DeckSize;
  customization: BuildPlanSettings;
  selectedThemes: ThemeResult[] | undefined;
  edhrecData: EDHRECCommanderData | null | undefined;
  /** What the build falls back to without a user theme (`decideBuildArchetype`'s
   *  `fallback`; a saved deck records it as `buildReport.archetype`). */
  archetypeFallback: Archetype;
  hasPartner: boolean;
  /** The commander's payoff is attacking (`commanderWantsExtraCombat`). */
  commanderWantsExtraCombat: boolean;
}

export interface BuildPlan {
  archetype: Archetype;
  /** The pacing the build and its grade read: the user's pick, else auto-detected. */
  pacing: Pacing;
  /** Role targets with the board-centric wipe shave applied. */
  roleTargets: Record<RoleKey, number>;
  roleTargetBreakdown: Record<RoleKey, RoleTargetBreakdown>;
  /** The wipe target was cut by one for a board-centric plan. */
  wipeTargetShaved: boolean;
  /** The ramp target before the shave (the land formula reads it). */
  plannedRampCount: number;
  resolvedLandCount: number;
  landCountAutoTuned: boolean;
  /** Sizing-only anchor for the type passes; the flat default when not auto-tuned. */
  landCountSizingAnchor: number;
  typeTargetLandCount: number;
  composition: TargetCountsResult['composition'];
  typeTargets: TargetCountsResult['typeTargets'];
  curveTargets: TargetCountsResult['curveTargets'];
}

export function resolveBuildPlan(input: BuildPlanInput): BuildPlan {
  const { format, customization, edhrecData } = input;
  const dynamic = getDynamicRoleTargets(
    format,
    input.selectedThemes,
    edhrecData?.stats,
    edhrecData,
    null, // E121: was customization.advancedTargets?.edhrecBlendWeight (deleted, dead at default)
    null, // E121: was customization.advancedTargets?.edhrecInclusionThreshold (deleted, dead at default)
    input.archetypeFallback
  );
  const archetype = dynamic.archetype;
  const pacing = customization.tempoAutoDetect ? dynamic.pacing : customization.tempoPacing;

  // Karsten land-count formula: only when the user hasn't customized land
  // inputs (still at the store defaults) — an explicit user choice is never
  // second-guessed. Uses the deck's planned ramp-slot target (blended EDHREC
  // + archetype model) + the EDHREC average CMC.
  let resolvedLandCount = customization.landCount;
  let landCountSizingAnchor = DEFAULT_LAND_COUNT;
  let landCountAutoTuned = false;
  const plannedRampCount = dynamic.targets.ramp;
  if (karstenAppliesToFormat(format) && isDefaultLandCount(customization) && edhrecData) {
    const manaCurve = edhrecData.stats?.manaCurve ?? {};
    const curveTotal = Object.values(manaCurve).reduce((s, v) => s + v, 0);
    const avgCmc =
      curveTotal > 0
        ? Object.entries(manaCurve).reduce((s, [cmc, count]) => s + Number(cmc) * count, 0) /
          curveTotal
        : 0;
    resolvedLandCount = computeAutoLandCount(archetype, plannedRampCount, avgCmc);
    landCountSizingAnchor = computeLandCountSizingAnchor(archetype, plannedRampCount, avgCmc);
    landCountAutoTuned = true;
  }

  // E88 + E94: when the auto-tune RAISES land count above the sizing anchor,
  // size the type passes as if lands were still at that anchor (generation's
  // phaseLandSqueezeReconcile reconciles the surplus down).
  const typeTargetLandCount = landCountAutoTuned
    ? Math.min(resolvedLandCount, landCountSizingAnchor)
    : resolvedLandCount;

  const { composition, typeTargets, curveTargets } = calculateTargetCounts(
    customization,
    edhrecData?.stats,
    input.hasPartner,
    pacing,
    resolvedLandCount,
    typeTargetLandCount
  );
  // Archetype identity floor on top of EDHREC's purely stats-driven type targets.
  applyArchetypeTypeFloor(
    typeTargets,
    archetype,
    Object.values(typeTargets).reduce((s, v) => s + v, 0)
  );

  // E109: one more point off the board wipe target for a board-centric plan,
  // floored at 1 (a board-centric deck still wants a reset button). Cuts the
  // target and its disclosed breakdown together so they can't drift apart.
  let roleTargets = dynamic.targets;
  let roleTargetBreakdown = dynamic.breakdown;
  let wipeTargetShaved = false;
  if (
    isBoardCentricPlan(archetype, typeTargets, input.commanderWantsExtraCombat) &&
    roleTargets.boardwipe > 1
  ) {
    const shaved = roleTargets.boardwipe - 1;
    roleTargets = { ...roleTargets, boardwipe: shaved };
    roleTargetBreakdown = {
      ...roleTargetBreakdown,
      boardwipe: { ...roleTargetBreakdown.boardwipe, blended: shaved },
    };
    wipeTargetShaved = true;
  }

  return {
    archetype,
    pacing,
    roleTargets,
    roleTargetBreakdown,
    wipeTargetShaved,
    plannedRampCount,
    resolvedLandCount,
    landCountAutoTuned,
    landCountSizingAnchor,
    typeTargetLandCount,
    composition,
    typeTargets,
    curveTargets,
  };
}
