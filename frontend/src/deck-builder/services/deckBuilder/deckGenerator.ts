import { logger } from '@/lib/logger';
import { formatMoney } from '@/lib/format-money';
import type {
  ScryfallCard,
  GeneratedDeck,
  DeckCategory,
  DeckDataSource,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  TargetBracket,
  BudgetOption,
  GapAnalysisCard,
  CoherenceRepair,
  Customization,
  DetectedCombo,
  ComboUpsideNote,
  ThemeResult,
} from '@/deck-builder/types';
import {
  getCardByName,
  getCardsByNames,
  prefetchBasicLands,
  getCachedCard,
  getGameChangerNames,
  getCardPrice,
  getFrontFaceTypeLine,
  upgradeCardPrintings,
  isMdfcLand,
  isChannelLand,
  setForceLiveSearch,
} from '@/deck-builder/services/scryfall/client';
import { buildAlternatePool, type AlternatePoolResult } from './phaseAlternatePool';
import {
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
  fetchCommanderCombos,
  fetchSaltIndex,
  isPoolTooThin,
} from '@/deck-builder/services/edhrec/client';
import { bracketLabel } from './bracketEstimator';
import {
  loadTaggerData,
  hasTaggerData,
  getCardRole,
  validateCardRole,
  getCardSubtype,
  isProtectionPiece,
  isFreeInteraction,
  isUntapProducer,
  isBlinkProducer,
  isExileProducer,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import {
  computeGradeAndBracket,
  computeRoleCounts,
  buildInclusionIndex,
} from './commanderDeckAnalysis';
import {
  getDynamicRoleTargets,
  estimatePacingFromStats,
  inferArchetype,
  inferArchetypeFromEdhrecThemes,
  computeEdhrecRoleTargets,
} from './roleTargets';
import { buildCommanderProfile } from './commanderProfile';
import { ARCHETYPE_LABEL } from './strategyVocabulary';
import { Archetype } from '@/deck-builder/types';
import type { Pacing, RoleTargetBreakdown } from '@/deck-builder/types';
import { loadUserLists } from '@/deck-builder/hooks/useUserLists';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';
import {
  calculateTargetCounts,
  computeAutoLandCount,
  isDefaultLandCount,
  DEFAULT_LAND_COUNT,
} from './targetCounts';
import { applyArchetypeTypeFloor } from './curveUtils';
import { BudgetTracker } from './budgetTracker';
import { BracketGuard, bracketCeilings, ceilingsAreOpen } from './bracketGuard';
import {
  pickFromPrefetchedWithCurve,
  mergeWithAllNonLand,
  calculateCardPriority,
  isHighSynergyCard,
  PRICE_SANITY_RATIO,
} from './cardPicking';
import {
  categorizeCards,
  stampRoleSubtypes,
  collectSwapCandidates,
  computeRoleBoosts,
  routeCardByType,
  roleCapTolerance,
  ROLE_CAP_HATCH_MAX_PER_PASS,
} from './categorize';
import { fillWithScryfall, type FillHardGates } from './scryfallFill';
import { isUnsupportedSynergyPayoff } from './synergyDependency';
import {
  computePackageBoosts,
  computeLiftPickBoosts,
  computeUntapVisibilityBoosts,
  computeBlinkVisibilityBoosts,
  computeExileVisibilityBoosts,
  tallyAxisInvestment,
} from './packageBoost';
import { buildManabaseSummary } from './manabaseMath';
import { auditDeckCoherence } from './coherenceAudit';
import { buildSubstitutionPlan, type SubstituteRow } from './substituteFinder';
import { loadCardSimilar } from './cardSimilar';
import { resolveMultiCopyCards } from './multiCopy';
import {
  generateLands,
  countColorPips,
  CHANNEL_LAND_BOOST,
  MDFC_LAND_BOOST,
} from './landGenerator';

import {
  type GenerationContext,
  type GenerationState,
  createState,
  markUsed as stMarkUsed,
  markBanned as stMarkBanned,
  addMustInclude as stAddMustInclude,
  getComboBoosts as stGetComboBoosts,
  countAllCards as stCountAllCards,
} from './deckGeneration/state';
import { detectCombosPhase, refreshComboCompleteness } from './deckGeneration/phaseDetectCombos';
import { gapAnalysisPhase } from './deckGeneration/phaseGapAnalysis';
import { liftPicksPhase } from './deckGeneration/phaseLiftPicks';
import { ensureLiftPools, getLiftIndex, MAX_LIFT_SEEDS } from './deckGeneration/liftPools';
import { deckScorePhase } from './deckGeneration/phaseDeckScore';
import { cardRelevancyPhase } from './deckGeneration/phaseCardRelevancy';
import { stapleManaRocksPhase } from './deckGeneration/phaseStapleManaRocks';
import { finalStatsPhase } from './deckGeneration/phaseFinalStats';
import { applyComboFloor } from './deckGeneration/phaseApplyComboFloor';
import { applyBracketConvergence } from './deckGeneration/phaseBracketConverge';
import { applyCoherenceRepair } from './deckGeneration/phaseCoherenceRepair';
import { applyBudgetConvergence } from './deckGeneration/phaseBudgetConverge';
import { applyRoleSurplusRebalance } from './deckGeneration/phaseRoleSurplusRebalance';
import { applyLandSqueezeReconcile } from './deckGeneration/phaseLandSqueezeReconcile';
import {
  MUST_INCLUDE_BOOST,
  LAND_PROTECTION_BOOST,
  COMBO_TRIM_BOOST,
  ROLE_DEFICIT_TRIM_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
} from './deckGeneration/trimResistanceConstants';
import { frontFaceName } from '@/lib/card-text';

// Re-exported so existing consumers keep importing from here (stable public API).
export { calculateStats } from './deckStats';
export { stampRoleSubtypes } from './categorize';
export { CHANNEL_LAND_BOOST, MDFC_LAND_BOOST } from './landGenerator';
export {
  MUST_INCLUDE_BOOST,
  LAND_PROTECTION_BOOST,
  COMBO_TRIM_BOOST,
  ROLE_DEFICIT_TRIM_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
};
export type { GenerationContext };

/**
 * Return the simple card type string from a lowercased type line, or null for
 * lands and unrecognised types. Used for counting/targeting by type.
 */
function getSimpleCardType(typeLine: string): string | null {
  if (typeLine.includes('land')) return null;
  return typeLine.includes('creature')
    ? 'creature'
    : typeLine.includes('instant')
      ? 'instant'
      : typeLine.includes('sorcery')
        ? 'sorcery'
        : typeLine.includes('artifact')
          ? 'artifact'
          : typeLine.includes('enchantment')
            ? 'enchantment'
            : typeLine.includes('planeswalker')
              ? 'planeswalker'
              : null;
}

// Merge cardlists from multiple theme results
function mergeThemeCardlists(themeDataResults: EDHRECCommanderData[]): {
  cardlists: EDHRECCommanderData['cardlists'];
  themeOverlapCounts: Map<string, number>;
} {
  // Track how many themes each card appears in (for hyper focus mode)
  const themeOverlapCounts = new Map<string, number>();

  // Merge all cards, keeping the best version for duplicates
  // Prioritize: highest synergy first, then highest inclusion
  const mergeCards = (cards: EDHRECCard[][]): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      // Track which cards we've seen in THIS theme's list to avoid double-counting
      const seenInThisList = new Set<string>();
      for (const card of cardList) {
        if (!seenInThisList.has(card.name)) {
          seenInThisList.add(card.name);
          themeOverlapCounts.set(card.name, (themeOverlapCounts.get(card.name) ?? 0) + 1);
        }

        const existing = cardMap.get(card.name);
        if (!existing) {
          cardMap.set(card.name, card);
        } else {
          // Keep the card with better synergy, or if tied, better inclusion
          const existingSynergy = existing.synergy ?? 0;
          const newSynergy = card.synergy ?? 0;

          if (
            newSynergy > existingSynergy ||
            (newSynergy === existingSynergy && card.inclusion > existing.inclusion)
          ) {
            cardMap.set(card.name, card);
          }
        }
      }
    }

    // Sort by priority (synergy-aware)
    return Array.from(cardMap.values()).sort(
      (a, b) => calculateCardPriority(b) - calculateCardPriority(a)
    );
  };

  const cardlists = {
    creatures: mergeCards(themeDataResults.map((r) => r.cardlists.creatures)),
    instants: mergeCards(themeDataResults.map((r) => r.cardlists.instants)),
    sorceries: mergeCards(themeDataResults.map((r) => r.cardlists.sorceries)),
    artifacts: mergeCards(themeDataResults.map((r) => r.cardlists.artifacts)),
    enchantments: mergeCards(themeDataResults.map((r) => r.cardlists.enchantments)),
    planeswalkers: mergeCards(themeDataResults.map((r) => r.cardlists.planeswalkers)),
    lands: mergeCards(themeDataResults.map((r) => r.cardlists.lands)),
    allNonLand: mergeCards(themeDataResults.map((r) => r.cardlists.allNonLand)),
  };

  return { cardlists, themeOverlapCounts };
}

/**
 * Fetch + merge all selected EDHREC themes for a given bracket (or `undefined`
 * for the bracket-agnostic page). Each theme's fetch failure is swallowed
 * (logged) so one theme's 404/network error doesn't sink the others; returns
 * `null` only when every theme failed. Shared by the normal fetch phase and
 * the E93 thinness fallback ladder below, so both go through one fetch+merge
 * path instead of two hand-rolled copies.
 */
async function fetchMergedThemeData(
  themes: ThemeResult[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  budgetOption: BudgetOption | undefined,
  bracket: TargetBracket | undefined
): Promise<{ data: EDHRECCommanderData; themeOverlapCounts: Map<string, number> } | null> {
  const results = await Promise.all(
    themes.map((theme) =>
      (partnerCommanderName
        ? fetchPartnerThemeData(
            commanderName,
            partnerCommanderName,
            theme.slug!,
            budgetOption,
            bracket
          )
        : fetchCommanderThemeData(commanderName, theme.slug!, budgetOption, bracket)
      ).catch((err) => {
        logger.warn(`[DeckGen] theme fetch failed, skipping "${theme.slug}":`, err);
        return null;
      })
    )
  );
  const ok = results.filter((r): r is EDHRECCommanderData => r != null);
  if (ok.length === 0) return null;
  const merged = mergeThemeCardlists(ok);
  return {
    data: { themes: [], stats: ok[0].stats, cardlists: merged.cardlists, similarCommanders: [] },
    themeOverlapCounts: merged.themeOverlapCounts,
  };
}

/** The EDHREC pool candidates the E93 thinness ladder can land on, from most
 *  to least specific. Mirrors the existing DeckDataSource labels so the
 *  Build Report's "which pool" line needs no new vocabulary. */
export type PoolRung = Extract<DeckDataSource, 'theme+bracket' | 'base+bracket' | 'theme' | 'base'>;

/**
 * Ladder through EDHREC pool candidates from most to least specific (E93),
 * stopping at the first with real signal (isPoolTooThin === false). If every
 * candidate is thin, returns the LAST successfully-fetched rung — the
 * broadest page tried is still the best data available, and it's what the
 * pre-E93 error-only fallback would have landed on anyway. Returns `null`
 * only when every rung's fetch threw (matches pre-E93 total-failure behavior).
 */
export async function fetchPoolWithFallback(
  rungs: Array<{ source: PoolRung; fetch: () => Promise<EDHRECCommanderData> }>
): Promise<{ data: EDHRECCommanderData; source: PoolRung; fellBackFrom?: PoolRung } | null> {
  let last: { data: EDHRECCommanderData; source: PoolRung } | null = null;
  for (const rung of rungs) {
    const data = await rung.fetch().catch(() => null);
    if (!data) continue;
    last = { data, source: rung.source };
    if (!isPoolTooThin(data)) break;
  }
  if (!last) return null;
  return { ...last, fellBackFrom: last.source !== rungs[0].source ? rungs[0].source : undefined };
}

/** Human-readable label for one EDHREC page rung, for the E93 disclosure note. */
function poolRungLabel(
  source: PoolRung,
  bracketPhrase: string,
  themeNames: string | undefined
): string {
  switch (source) {
    case 'theme+bracket':
      return `the ${themeNames} page filtered to ${bracketPhrase}`;
    case 'base+bracket':
      return `the main ${bracketPhrase} page`;
    case 'theme':
      return `the main ${themeNames} page`;
    case 'base':
      return 'the main commander page';
  }
}

/**
 * E93 disclosure text: names what EDHREC page was too thin, what page was
 * used instead, and confirms the target bracket's card permissions (which
 * only ever control curve/salt/game-changer ceilings downstream — never the
 * pool fetch itself) were kept regardless of which page supplied the pool.
 */
export function buildBracketPoolFallbackNote(
  commanderLabel: string,
  targetBracket: TargetBracket,
  fellBackFrom: PoolRung,
  usedSource: PoolRung,
  themeNames: string | undefined
): string {
  const bracketPhrase = `bracket-${targetBracket} (${bracketLabel(Number(targetBracket))})`;
  const subject = themeNames ? `${commanderLabel} + ${themeNames}` : commanderLabel;
  const missingLabel = poolRungLabel(fellBackFrom, bracketPhrase, themeNames);
  const usedLabel = poolRungLabel(usedSource, bracketPhrase, themeNames);
  return `EDHREC has too little data on ${missingLabel} for ${subject} — built from ${usedLabel} instead, with ${bracketPhrase} card permissions kept.`;
}

// ---- Fast regeneration cache ----
// Caches EDHREC + Scryfall data from the first generation so regenerations
// (ban a card, add a must-include, tweak settings) can skip the fetch phase entirely.
interface GenerationCache {
  edhrecData: EDHRECCommanderData;
  baseData: EDHRECCommanderData | null;
  cardMap: Map<string, ScryfallCard>;
  themeOverlapCounts: Map<string, number>;
  combos: EDHRECCombo[];
  gameChangerNames: Set<string>;
  dataSource: DeckDataSource;
  bracketPoolFallbackNote: string | undefined;
  representativeStats: EDHRECCommanderStats;
  // Cache keys — ALL must match for a cache hit
  commanderName: string;
  partnerName: string | null;
  themeSlugs: string[];
  targetBracket: TargetBracket | undefined;
  budgetOption: BudgetOption | undefined;
  // Isolates alternative generators so an art/oracle/historical pool can never be
  // served from (or pollute) a plain-EDHREC cache for the same commander.
  modeKey: string;
}

let generationCache: GenerationCache | null = null;

function buildCacheKey(context: GenerationContext) {
  const { commander, partnerCommander, customization } = context;
  const selectedThemesWithSlugs =
    context.selectedThemes?.filter((t) => t.isSelected && t.source === 'edhrec' && t.slug) || [];
  return {
    commanderName: commander.name,
    partnerName: partnerCommander?.name ?? null,
    themeSlugs: selectedThemesWithSlugs.map((t) => t.slug!).sort(),
    targetBracket: (customization.targetBracket !== 'all'
      ? customization.targetBracket
      : undefined) as TargetBracket | undefined,
    budgetOption: (customization.budgetOption !== 'any'
      ? customization.budgetOption
      : undefined) as BudgetOption | undefined,
    modeKey: [
      customization.generationMode ?? 'edhrec',
      customization.artThemeTag ?? '',
      customization.historicalYear ?? '',
      customization.permanentsOnly ? 'perm' : '',
    ].join('|'),
  };
}

function isCacheValid(context: GenerationContext): boolean {
  if (!generationCache) return false;
  const key = buildCacheKey(context);
  return (
    generationCache.commanderName === key.commanderName &&
    generationCache.partnerName === key.partnerName &&
    generationCache.targetBracket === key.targetBracket &&
    generationCache.budgetOption === key.budgetOption &&
    generationCache.modeKey === key.modeKey &&
    generationCache.themeSlugs.length === key.themeSlugs.length &&
    generationCache.themeSlugs.every((s, i) => s === key.themeSlugs[i])
  );
}

export function clearGenerationCache(): void {
  generationCache = null;
  logger.debug('[DeckGen] Generation cache cleared');
}

/** Expose the cached EDHREC data from the most recent generation (avoids re-fetching). */
export function getGenerationCacheEdhrecData(): EDHRECCommanderData | null {
  return generationCache?.edhrecData ?? null;
}

/**
 * Early lift-seed set (E71 slice 2), collected BEFORE any card is picked:
 * commander(s), then EDHREC-pool cards flagged isThemeSynergyCard, then
 * must-includes. Note isThemeSynergyCard is set on every EDHREC response's
 * highsynergy/topcards lists (not only theme-slug fetches), so in a no-theme
 * build these seeds are the commander's own base high-synergy cards — the
 * same theme-independent bias picking already applies via isHighSynergyCard.
 * No implicit "lift as theme" switch: with no selected theme the fetched
 * pool is the base commander page, never a theme page.
 * Deduped, capped at MAX_LIFT_SEEDS. Deck cards picked later add further
 * seeds via phaseLiftPicks' own collectSeeds, sharing the same pool/cap.
 */
function collectEarlyLiftSeeds(state: GenerationState): string[] {
  const seeds: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    if (!name || seen.has(name) || seeds.length >= MAX_LIFT_SEEDS) return;
    seen.add(name);
    seeds.push(name);
  };

  add(state.context.commander.name);
  add(state.context.partnerCommander?.name);
  if (state.edhrecData) {
    const themeCards = state.edhrecData.cardlists.allNonLand
      .filter((c) => c.isThemeSynergyCard)
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
    for (const c of themeCards) add(c.name);
  }
  for (const name of state.mustIncludeNames) add(name);

  return seeds;
}

/**
 * Compose `landCountNote` — still composed late, from FINAL deck state (the
 * deck's own final average CMC, and the delivered land count when it moved),
 * never from auto-tune-time curve values, which go stale the moment
 * coherence-repair/bracket-convergence swap the deck afterward. But the
 * "Auto-tuned to N" headline number is the tune's RESOLVED target, not the
 * delivered count: downstream phases (colorless-pool backfill, coherence
 * repair) can legitimately deliver more/fewer lands than the tune resolved,
 * and printing the delivered count as if the tune chose it misstates what the
 * auto-tune did (a Kozilek tune of 36 delivering 40 read as "Auto-tuned to
 * 40"). When the two differ, both are disclosed. `isLowConfidence` softens the
 * archetype reference when the label came only from the oracle-text
 * keyword-vote heuristic, not a real EDHREC theme or user pick — naming a
 * wrong archetype ("for a Voltron deck") is worse than naming none ("for this
 * deck's profile").
 */
export function buildLandCountNote(params: {
  resolvedLandCount: number;
  finalLandCount: number;
  archetype: Archetype;
  isLowConfidence: boolean;
  edhrecRampCount: number;
  finalAvgCmc: number;
}): string {
  const label = ARCHETYPE_LABEL[params.archetype];
  const archetypeText = params.isLowConfidence
    ? "for this deck's profile"
    : `for ${/^[AEIOU]/i.test(label) ? 'an' : 'a'} ${label} deck`;
  const deliveredClause =
    params.finalLandCount !== params.resolvedLandCount
      ? `; delivered ${params.finalLandCount} after post-tune deck adjustments`
      : '';
  return `Auto-tuned to ${params.resolvedLandCount} lands ${archetypeText} (${params.edhrecRampCount} typical ramp sources, avg CMC ${params.finalAvgCmc.toFixed(1)})${deliveredClause} — set land count explicitly under Customize to override.`;
}

/**
 * Compose the honest budget disclosure from the FINAL deck total (summed
 * after every mutating phase, including budget convergence — see
 * phaseBudgetConverge.ts). Three outcomes:
 *  - Under budget, no convergence needed: undefined (nothing to say).
 *  - Convergence brought an over-budget deck in: names the substitution count.
 *  - Still over budget after convergence gave up: names the total, the
 *    overage, the substitution count, and WHY it's stuck (residualReason) —
 *    falling back to the older "combo upgrades skipped" clause when
 *    convergence never ran (e.g. offline, no EDHREC pool).
 */
export function buildOverBudgetNote(params: {
  finalTotal: number;
  deckBudget: number;
  currency: 'USD' | 'EUR';
  comboBudgetSkipCount: number;
  /** Substitutions phaseBudgetConverge applied (0 when it never ran/found nothing). */
  convergedSwapCount?: number;
  /** Honest reason convergence stopped short of budget — set only when still over. */
  residualReason?: string;
}): string | undefined {
  const sym = params.currency === 'EUR' ? '€' : '$';
  const swaps = params.convergedSwapCount ?? 0;
  const swapWord = swaps === 1 ? 'substitution' : 'substitutions';

  if (params.finalTotal <= params.deckBudget) {
    if (swaps > 0) {
      return `Deck totals ${sym}${params.finalTotal.toFixed(2)} — landed under your ${sym}${params.deckBudget} budget after ${swaps} ${swapWord}.`;
    }
    return undefined;
  }

  const over = params.finalTotal - params.deckBudget;
  const substitutionClause = swaps > 0 ? ` after ${swaps} ${swapWord}` : '';
  // Semicolon-join the "why stuck" reason onto the same sentence (it explains
  // the number just stated); the older combo-skip disclosure reads better as
  // its own sentence, and only ever applies when convergence never ran.
  const tail = params.residualReason
    ? `; ${params.residualReason}.`
    : params.comboBudgetSkipCount > 0
      ? '. Some combo upgrades were skipped to stay as close as possible.'
      : '.';
  return `Deck totals ${sym}${params.finalTotal.toFixed(2)} — ${sym}${over.toFixed(2)} over your ${sym}${params.deckBudget} budget${substitutionClause}${tail}`;
}

// ─── Role-cap gate for backfill paths outside cardPicking.ts/scryfallFill.ts ──
// (E77 iter-4 round 2). Both callers below already hold a full ScryfallCard
// (no pre-built cardRoleMap needed, unlike the EDHREC-pool picker), so a
// direct validateCardRole check is the smaller diff than threading through
// RoleCapConfig/RoleCapGate. Same cap shape (target + roleCapTolerance) as
// every other gated path — one constant, three surfaces.
export function isOverRoleCap(
  card: ScryfallCard,
  roleTargets: Record<RoleKey, number> | null,
  currentRoleCounts: Record<RoleKey, number>
): boolean {
  if (!roleTargets) return false;
  const role = validateCardRole(card);
  if (!role) return false;
  const target = roleTargets[role] ?? 0;
  if (target <= 0) return false;
  return (currentRoleCounts[role] ?? 0) >= target + roleCapTolerance(target);
}

export function bumpRoleCapCount(
  card: ScryfallCard,
  roleTargets: Record<RoleKey, number> | null,
  currentRoleCounts: Record<RoleKey, number>,
  overflowCounts: Partial<Record<RoleKey, number>>,
  isOverflow: boolean
): void {
  if (!roleTargets) return;
  const role = validateCardRole(card);
  if (!role) return;
  currentRoleCounts[role] = (currentRoleCounts[role] ?? 0) + 1;
  if (isOverflow) overflowCounts[role] = (overflowCounts[role] ?? 0) + 1;
}

export function roleCapOverage(
  card: ScryfallCard,
  roleTargets: Record<RoleKey, number> | null,
  currentRoleCounts: Record<RoleKey, number>
): number {
  if (!roleTargets) return 0;
  const role = validateCardRole(card);
  if (!role) return 0;
  return (currentRoleCounts[role] ?? 0) - (roleTargets[role] ?? 0);
}

const ROLE_DISPLAY: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

/**
 * Disclosure for the role-cap escape hatch (E77 iter-4) — every gated path
 * (pick loop, Scryfall fallback, shortage backfill, owned substitutes)
 * increments the same shared counter when it admits an over-cap card rather
 * than shipping the deck short. Mirrors the `buildDisclosureNote` idiom in
 * phaseLiftPicks.ts: one terse note naming the total and the dominant role,
 * not per-card spam. Undefined when the hatch never actually fired.
 *
 * Deliberately narrow (round 3 fix): this counts ONLY escape-hatch
 * admissions, not the deck's total role overshoot — exempt picks
 * (must-includes, combo floor) and in-tolerance amounts can push a role's
 * final count well past this number, and `roleExcesses` (Overbuilt roles)
 * is the full accounting for that. Wording must never read as "the total is
 * N" when Overbuilt roles can show a larger one for the same role.
 */
export function buildRoleCapOverflowNote(
  counts: Partial<Record<RoleKey, number>>
): string | undefined {
  const entries = (Object.entries(counts) as [RoleKey, number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return undefined;
  const [dominantRole] = entries.sort((a, b) => b[1] - a[1]);
  return `${total} card${total === 1 ? '' : 's'} pushed past its role cap to finish the deck (${ROLE_DISPLAY[dominantRole[0]]} pool was thin) — see Overbuilt roles below for the full total.`;
}

/**
 * E80 product ruling: price-sanity (cardPicking.ts's priceSanityTieBreak)
 * ships as the DEFAULT, not an opt-in. `customization.priceSanity` is the
 * escape hatch, not the primary switch — undefined defers to budgetOption:
 * ON normally, OFF when the user explicitly asked for the 'expensive' pool
 * (they already told the generator they want premium picks; the tie-break
 * would just fight that choice). An explicit true/false always wins over
 * the budgetOption inference.
 */
export function resolvePriceSanity(
  customization: Pick<Customization, 'priceSanity' | 'budgetOption'>
): boolean {
  return customization.priceSanity ?? customization.budgetOption !== 'expensive';
}

/**
 * Disclosure for the price-sanity tie-break (E80) — mirrors the
 * buildRoleCapOverflowNote idiom: one terse note naming the total, not
 * per-card spam. Undefined when the tie-break never actually decided an
 * outcome (off via budgetOption='expensive'/explicit false, or no
 * qualifying same-role/comparable-inclusion/dramatic-price-gap pair ever
 * arose in this generation).
 */
export function buildPriceSanityNote(decidedCount: number): string | undefined {
  if (decidedCount <= 0) return undefined;
  return `Preferred ${decidedCount} cheaper near-equivalent${decidedCount === 1 ? '' : 's'} over premium picks — set budget preference to "expensive" to disable.`;
}

/**
 * E82 fix-round: phaseLandSqueezeReconcile.ts's `cut`/`wildcardsKept` are
 * correct as of the moment that phase runs, but combo audit / coherence
 * repair / budget convergence / bracket convergence all run AFTER it and can
 * still cut a wildcard it just kept, or (far rarer) re-add a name it just
 * cut — those phases have their own disclosure (coherenceRepairs,
 * surplusConversions, …) for whatever THEY change, so this note must not
 * keep naming a card that no longer reflects the truth. Reconciles the
 * phase's own lists to the actual FINAL deck: a "kept" wildcard is only
 * disclosed if it's still in the deck; a "cut" incumbent is only disclosed
 * if it never came back. Guarantees every name buildLandSqueezeTrimNote
 * receives is on the correct side of `finalNonLandNames` — the property a
 * differ audit (E82 attempt 6 fix-round) caught missing: a misattributed
 * "kept" wildcard that was actually an unchanged holdover, and a "cut"
 * incumbent that was never in the deck at all (both symptoms of composing
 * straight from the phase's own intermediate lists instead of the final
 * state).
 */
export function reconcileLandSqueezeDisclosure(
  cut: readonly string[],
  wildcardsKept: readonly string[],
  finalNonLandNames: ReadonlySet<string>
): { cut: string[]; wildcardsKept: string[] } {
  return {
    cut: cut.filter((name) => !finalNonLandNames.has(name)),
    wildcardsKept: wildcardsKept.filter((name) => finalNonLandNames.has(name)),
  };
}

/**
 * E88 + E82 attempt 6 disclosure: names the cards phaseLandSqueezeReconcile.ts
 * cut to bring the deck back to size after auto-tuning land count up past the
 * 37-land baseline, plus (independently) any leftover cards its wildcard scan
 * added that outscored an incumbent. Composed POST-HOC from the phase's own
 * `cut`/`wildcardsKept` lists (never from inside a sort comparator — see
 * buildComboUpsideNotes's doc for why comparator-side collection is
 * structurally unreliable) — callers MUST run them through
 * `reconcileLandSqueezeDisclosure` first so both lists already agree with the
 * final deck. The two aren't 1:1 pairable (one combined sort/cut over both
 * sets, not N independent swaps — see phaseLandSqueezeReconcile.ts's
 * header), so wildcards get their own sentence rather than a misleading
 * per-card pairing. Undefined when neither the squeeze cut nor the wildcard
 * scan did anything (the common case).
 */
export function buildLandSqueezeTrimNote(
  cutNames: readonly string[],
  wildcardsKept: readonly string[],
  finalLandCount: number,
  defaultLandCount: number
): string | undefined {
  if (cutNames.length === 0 && wildcardsKept.length === 0) return undefined;
  let note = '';
  if (cutNames.length > 0) {
    const extra = finalLandCount - defaultLandCount;
    note = `Auto-tuned land count to ${finalLandCount} (${extra} more than the ${defaultLandCount}-land default) left ${cutNames.length} fewer spell slot${cutNames.length === 1 ? '' : 's'} than usual — reconciled by cutting the lowest-value pick${cutNames.length === 1 ? '' : 's'}: ${cutNames.join(', ')}.`;
  }
  if (wildcardsKept.length > 0) {
    const wildcardSentence = `${note ? 'Additionally, ' : ''}${wildcardsKept.length} stronger leftover card${wildcardsKept.length === 1 ? '' : 's'} (${wildcardsKept.join(', ')}) displaced an equal number of the deck's weakest picks.`;
    note = note ? `${note} ${wildcardSentence}` : wildcardSentence;
  }
  return note;
}

/**
 * Emergent combo-completion disclosure: names combos that were NOT complete
 * at generation start but ARE complete in the final deck — i.e. the
 * algorithm's own picks (curve/role/synergy fill, combo floor, coherence
 * repair, …) completed a latent combo with cards already locked in
 * (commander, must-includes), with zero prior disclosure. Composed
 * POST-HOC by the caller diffing state.baselineDetectedCombos against the
 * truly-final detectedCombos — this function only turns that diff into
 * prose. One row per combo (live decks can complete a dozen+ at once — see
 * comboUpsideNotes for the same one-row-per-item precedent) rather than a
 * single run-on sentence. Undefined when nothing newly completed (the
 * common case).
 */
export function buildComboCompletionNote(newlyComplete: DetectedCombo[]): string[] | undefined {
  if (newlyComplete.length === 0) return undefined;
  return newlyComplete.map((combo) => {
    const cards = combo.cards.join(' + ');
    const results = combo.results.length > 0 ? combo.results.join(', ') : 'a combo finish';
    return `${cards} — produces ${results}`;
  });
}

/**
 * Combo-upside price disclosure: priceSanityTieBreak (cardPicking.ts)
 * deliberately never fights a live combo-assembly boost — an expensive combo
 * piece SHOULD beat a cheap same-role staple when it's genuinely 2-of-3
 * toward an engine. Correct, but silent: the user pays the premium without
 * being told why.
 *
 * This is deliberately a POST-HOC search, not a comparator-collector: an
 * earlier version tried to record evidence from inside the sort comparator
 * (priceSanityTieBreak), but a live Kozilek run proved that structurally
 * dead — Array.sort() only makes O(n log n) comparisons, and a deep-pool
 * combo piece (Grim Monolith, 22% inclusion) is never directly compared
 * against the pool's actual cheap staple (Mind Stone, 86% inclusion); their
 * relative order is inferred transitively through other comparisons instead.
 * The evidence map stayed empty all generation despite 4 incomplete combos
 * and a picked expensive piece. So instead of trying to catch the moment
 * price-sanity stands down, this scans the FINAL deck directly: for every
 * shipped card carrying a live combo boost whose combo(s) are all still
 * incomplete, it searches the whole EDHREC candidate pool (the same
 * batch-fetched map picking actually drew from) for a same-role,
 * higher-or-equal-inclusion, dramatically-cheaper card that never made the
 * deck — deterministic, independent of sort/comparator internals.
 */
export function buildComboUpsideNotes(
  finalDeckCards: readonly ScryfallCard[],
  staticComboBoosts: ReadonlyMap<string, number>,
  detectedCombos: DetectedCombo[] | undefined,
  edhrecData: EDHRECCommanderData | null | undefined,
  poolCardMap: ReadonlyMap<string, ScryfallCard>,
  currency: 'USD' | 'EUR'
): ComboUpsideNote[] | undefined {
  if (!detectedCombos || detectedCombos.length === 0 || !edhrecData || poolCardMap.size === 0) {
    return undefined;
  }

  const inclusionIndex = buildInclusionIndex(edhrecData);
  const finalNames = new Set(finalDeckCards.map((c) => c.name));
  const notes: ComboUpsideNote[] = [];

  for (const card of finalDeckCards) {
    if ((staticComboBoosts.get(card.name) ?? 0) <= 0) continue;

    // Nearest-to-complete incomplete combo this card belongs to (fewest
    // missing pieces first) — the most informative one to name. A card
    // whose every combo went on to complete already paid for itself.
    const incomplete = detectedCombos
      .filter((dc) => !dc.isComplete && dc.cards.includes(card.name))
      .sort(
        (a, b) => a.missingCards.length - b.missingCards.length || a.cards.length - b.cards.length
      );
    const dc = incomplete[0];
    if (!dc) continue;

    const price = parseFloat(getCardPrice(card, currency) ?? '');
    if (!isFinite(price) || price <= 0) continue;

    const role = validateCardRole(card);
    if (!role) continue; // same role-gate the picker's price-sanity tie-break uses

    const cardInclusion = inclusionIndex.get(card.name) ?? 0;

    // Cheapest same-role, higher-or-equal-inclusion, dramatically-cheaper
    // alternative that never made the final deck.
    let cheapest: { name: string; price: number } | undefined;
    for (const [altName, altCard] of poolCardMap) {
      if (altName === card.name || finalNames.has(altName)) continue;
      if ((inclusionIndex.get(altName) ?? 0) < cardInclusion) continue;
      if (validateCardRole(altCard) !== role) continue;
      const altPrice = parseFloat(getCardPrice(altCard, currency) ?? '');
      if (!isFinite(altPrice) || altPrice <= 0) continue;
      if (price / altPrice < PRICE_SANITY_RATIO) continue;
      if (!cheapest || altPrice < cheapest.price) cheapest = { name: altName, price: altPrice };
    }
    if (!cheapest) continue;

    notes.push({
      name: card.name,
      price: formatMoney(price, { currency, wholeDollars: true }),
      produces: dc.results.join(', ') || 'a combo',
      missingCards: dc.missingCards,
      ownedPieces: dc.cards.length - dc.missingCards.length,
      totalPieces: dc.cards.length,
      comparedName: cheapest.name,
      comparedPrice: formatMoney(cheapest.price, { currency, wholeDollars: true }),
    });
  }
  return notes.length > 0 ? notes : undefined;
}

// ── Smart Trim resistance constants (priority-aware, role-aware, combo-aware) ──
// Live in deckGeneration/trimResistanceConstants.ts (E88, imported up top) so
// phaseLandSqueezeReconcile.ts can reuse them without a circular import back
// into this file.

// E89 (iter-7 Slice E) — a commander-side "wants untap" signal distinct from
// isUntapProducer. Urianger Augurelt's real oracle text (verified against
// Scryfall) has no untap wording at all — his Draw/Play Arcanum abilities
// are both plain "{T}: ..." activated abilities, so what he "wants" is extra
// activations of his OWN ability, not producing untaps for others. Excludes
// bare mana abilities ("{T}: Add ...") so a mana-dork commander alone
// doesn't trip this — module-scope so it's a pure, unit-testable function
// independent of generateDeck's closure (see computeTrimResistance above).
const REUSABLE_TAP_ABILITY = /\{T\}:(?!\s*Add\b)/i;
export function hasReusableTapAbility(card: ScryfallCard): boolean {
  const text = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ?? '';
  return REUSABLE_TAP_ABILITY.test(text);
}

// iter-8 Slice B — a commander-side "wants exile-matters" signal distinct
// from isExileProducer. Urianger Augurelt's own text is real-verified as a
// non-match for isExileProducer (his "exile" clause is never immediately
// followed by "the top ... cards of your library" — that phrase belongs to
// the prior clause describing what was looked at), but his top-line ability
// ("Whenever you play a land from exile or cast a spell from exile, you gain
// 2 life") is a genuine cast-from-exile payoff identity — module-scope so
// it's a pure, unit-testable function, same placement reasoning as
// hasReusableTapAbility above.
const EXILE_PAYOFF = /\bwhenever you (?:play|cast)\b[\s\S]{0,20}?\bfrom exile\b/i;
export function hasExilePayoffIdentity(card: ScryfallCard): boolean {
  const text = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ?? '';
  return EXILE_PAYOFF.test(text);
}

/**
 * Per-card trim resistance for the Smart Trim pass: higher survives, lower
 * gets cut first. Position in its category is the base signal (cards are
 * already priority-ordered, so a higher index = lower priority = lower
 * resistance); must-includes, staple rocks, lands (up to the land target),
 * combo pieces, and role-deficit cards all add protection, while role
 * surplus (>= target+3) subtracts it.
 */
export function computeTrimResistance(
  card: ScryfallCard,
  positionIndex: number,
  categoryLength: number,
  category: DeckCategory,
  comboCardNames: ReadonlySet<string>,
  roleTargets: Record<RoleKey, number> | null,
  currentRoleCounts: Record<RoleKey, number>
): number {
  let resistance = categoryLength - positionIndex;

  if (card.isMustInclude) {
    resistance += MUST_INCLUDE_BOOST;
  }
  if (card.isStapleRock) {
    resistance += STAPLE_PROTECTION_BOOST;
  }
  if (isProtectionPiece(card)) {
    resistance += PROTECTION_PIECE_BOOST;
  }
  if (isFreeInteraction(card)) {
    resistance += FREE_INTERACTION_BOOST;
  }
  if (category === 'lands' && !card.isMustInclude) {
    resistance += LAND_PROTECTION_BOOST;
  }
  if (comboCardNames.has(card.name)) {
    resistance += COMBO_TRIM_BOOST;
  }
  if (roleTargets) {
    const role = validateCardRole(card);
    if (role) {
      const target = roleTargets[role] ?? 0;
      const current = currentRoleCounts[role] ?? 0;
      if (current <= target) {
        resistance += ROLE_DEFICIT_TRIM_BOOST;
      } else if (current >= target + 3) {
        resistance += ROLE_SURPLUS_TRIM_PENALTY;
      }
    }
  }

  return resistance;
}

/**
 * Public entry point. For the default EDHREC mode this is a passthrough. For the
 * alternative generators it forces all card fetches to the live API for the
 * duration of the build (the offline query parser can't evaluate otag:/art:/year<=).
 * The mode constraint itself is appended to `scryfallQuery` INSIDE generateDeckInner,
 * after the pool is built — so it reflects the pool's *effective* constraint (e.g.
 * a historical year that was relaxed to find enough cards), keeping the strict
 * printing-upgrade and fallback fills in lockstep with what was actually fetched.
 */
export async function generateDeck(context: GenerationContext): Promise<GeneratedDeck> {
  const mode = context.customization.generationMode ?? 'edhrec';
  if (mode === 'edhrec') return generateDeckInner(context);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'The alternative generators need an internet connection. Reconnect, or switch to Standard (EDHREC) mode.'
    );
  }

  setForceLiveSearch(true);
  try {
    return await generateDeckInner(context);
  } finally {
    setForceLiveSearch(false);
  }
}

// Main deck generation function
async function generateDeckInner(context: GenerationContext): Promise<GeneratedDeck> {
  const { commander, partnerCommander, colorIdentity, customization, onProgress } = context;
  const mode = customization.generationMode ?? 'edhrec';
  // Captured from the alternative-pool build so the finished deck can report how
  // it was made (e.g. a relaxed historical year). Null on EDHREC mode / cache hit.
  let altPool: AlternatePoolResult | null = null;

  const state = createState(context);
  const {
    usedNames,
    bannedCards,
    categories,
    currentCurveCounts,
    currentRoleCounts,
    currentSubtypeCounts,
    staticComboBoosts,
    comboCardNames,
    comboCards,
    gameChangerCount,
    mustIncludeNames,
    mustIncludeSources,
  } = state;
  const {
    format,
    maxCardPrice,
    budgetOption,
    targetBracket,
    maxRarity,
    maxCmc,
    arenaOnly,
    preferredSet,
    maxGameChangers,
    deckBudget,
    currency,
    ignoreOwnedBudget,
    ignoreOwnedRarity,
    collectionStrategy,
    collectionOwnedPercent,
    comboCountSetting,
    selectedThemesWithSlugs,
  } = state.cfg;
  // Reassignable: the alternative generators append their (post-relaxation)
  // constraint to this after the pool is built, so the strict printing upgrade
  // and Scryfall fallback fills enforce exactly the pool's effective filter.
  let scryfallQuery = state.cfg.scryfallQuery;
  const markUsed = (name: string) => stMarkUsed(state, name);
  const markBanned = (name: string) => stMarkBanned(state, name);
  const addMustInclude = (name: string, source: 'user' | 'deck' | 'combo') =>
    stAddMustInclude(state, name, source);
  const getComboBoosts = () => stGetComboBoosts(state);
  (customization.bannedCards || []).forEach(markBanned);
  // Merge enabled ban lists into the banned set
  for (const list of customization.banLists || []) {
    if (list.enabled) list.cards.forEach(markBanned);
  }
  // Merge applied exclude user lists
  const userLists = loadUserLists();
  for (const ref of customization.appliedExcludeLists || []) {
    if (ref.enabled) {
      const list = userLists.find((l) => l.id === ref.listId);
      if (list) list.cards.forEach(markBanned);
    }
  }
  // Merge temporary banned cards
  const tempBanned = customization.tempBannedCards ?? [];
  if (tempBanned.length > 0) {
    logger.debug(`[DeckGen] Temp banned cards:`, tempBanned);
    tempBanned.forEach(markBanned);
  }
  logger.debug(
    `[DeckGen] Budget settings: deckBudget=${deckBudget}, maxCardPrice=${maxCardPrice}, budgetOption=${budgetOption}, currency=${currency}${ignoreOwnedBudget ? ', ignoring owned for budget' : ''}${ignoreOwnedRarity ? ', ignoring owned for rarity' : ''}`
  );

  // Log banned cards if any
  if (bannedCards.size > 0) {
    logger.debug(`[DeckGen] Excluding ${bannedCards.size} banned cards:`, [...bannedCards]);
  }

  // Log collection mode
  if (context.collectionNames) {
    logger.debug(
      `[DeckGen] Collection mode (${collectionStrategy}${collectionStrategy === 'partial' ? `, ${collectionOwnedPercent}%` : ''}): ${constrainsToCollection(collectionStrategy) ? 'restricting to' : 'prioritizing'} ${context.collectionNames.size} owned cards`
    );
  }

  // Add commander(s) to used names
  markUsed(commander.name);
  if (partnerCommander) {
    markUsed(partnerCommander.name);
  }

  // --- Phase A: Data Acquisition (skippable via generation cache) ---
  const usingCache = isCacheValid(context);

  if (usingCache) {
    logger.debug('[DeckGen] FAST PATH: Reusing cached EDHREC + Scryfall data');
    onProgress?.('Reshuffling…', 5);
    state.gameChangerNames = generationCache!.gameChangerNames;
    state.combos = generationCache!.combos;
    state.edhrecData = generationCache!.edhrecData;
    state.dataSource = generationCache!.dataSource;
    state.bracketPoolFallbackNote = generationCache!.bracketPoolFallbackNote;
    state.baseData = generationCache!.baseData;
    state.themeOverlapCounts = generationCache!.themeOverlapCounts;
    await loadTaggerData();
    onProgress?.('Your library takes shape…', 12);
  } else {
    // FULL PATH: Pre-fetch basic lands, game changer list, combo data, and tagger data in parallel
    onProgress?.('Shuffling up…', 5);
    const [, fetchedGCNames, fetchedCombos] = await Promise.all([
      prefetchBasicLands(),
      getGameChangerNames(),
      fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
      loadTaggerData(),
      loadCardSimilar(), // EDHREC substitute index for shortage-fill ranking
    ]);
    state.gameChangerNames = fetchedGCNames;
    state.combos = fetchedCombos;
    onProgress?.('Studying the cards…', 7);
    logger.debug(`[DeckGen] Fetched ${state.combos.length} combos from EDHREC`);
    logger.debug(
      `[DeckGen] Tagger data: ${hasTaggerData() ? 'loaded' : 'unavailable (role detection disabled)'}`
    );
  }

  // Build combo priority boost map + combo membership index for dynamic boosting
  if (comboCountSetting > 0 && state.combos.length > 0) {
    // Scale combo attempts by deck size (baseline: 99 cards → 1→2, 2→4, 3→7)
    const sizeScale = Math.max(0.5, format / 99);
    const comboSliceCount = Math.max(1, Math.round(comboCountSetting * 2.33 * sizeScale));

    // Build inclusion index for this commander so we can prefer combos whose pieces
    // actually appear in this commander's typical builds over globally-popular combos.
    const comboInclusionIndex = new Map<string, number>();
    if (state.edhrecData) {
      for (const c of state.edhrecData.cardlists.allNonLand)
        comboInclusionIndex.set(c.name, c.inclusion);
    }

    // Score each combo by: EDHREC rank (already sorted) + relevance to this commander.
    // A combo where all pieces have 0% inclusion is deprioritized vs one with pieces
    // that players of this commander actually run.
    // At lower combo settings, require pieces to actually fit this commander's builds
    // so we don't pull in random 2-card combos that aren't thematically relevant.
    const comboInclusionFloor = comboCountSetting === 1 ? 25 : comboCountSetting === 2 ? 10 : 0;
    const scoredCombos = state.combos
      .filter((combo) => !combo.cards.some((c) => bannedCards.has(c.name)))
      .map((combo) => {
        const avgInclusion =
          combo.cards.reduce((sum, c) => sum + (comboInclusionIndex.get(c.name) ?? 0), 0) /
          combo.cards.length;
        // Rank score: lower rank = better (invert so higher is better)
        const rankScore = Math.max(0, 100 - combo.rank);
        // Relevance score: average inclusion % of combo pieces for this commander
        const relevanceScore = avgInclusion * 2;
        // Fewer pieces = easier to assemble
        const pieceBonus = combo.cards.length <= 2 ? 10 : 0;
        return { combo, score: rankScore + relevanceScore + pieceBonus, avgInclusion };
      })
      .filter((s) => s.avgInclusion >= comboInclusionFloor)
      .sort((a, b) => b.score - a.score);

    const combosToAttempt = scoredCombos.slice(0, comboSliceCount).map((s) => s.combo);
    logger.debug(
      `[DeckGen] Combo selection (top ${comboSliceCount} of ${scoredCombos.length}):`,
      scoredCombos.slice(0, comboSliceCount).map((s) => {
        const avgIncl =
          s.combo.cards.reduce((sum, c) => sum + (comboInclusionIndex.get(c.name) ?? 0), 0) /
          s.combo.cards.length;
        return `${s.combo.cards.map((c) => c.name).join(' + ')} (score=${s.score.toFixed(0)}, avgIncl=${avgIncl.toFixed(0)}%)`;
      })
    );
    const staticBoost = 75 * comboCountSetting; // 1→75, 2→150, 3→225
    for (const combo of combosToAttempt) {
      const cardSet = new Set(combo.cards.map((c) => c.name));
      comboCards.set(combo.comboId, cardSet);
      for (const card of combo.cards) {
        comboCardNames.add(card.name);
        const existing = staticComboBoosts.get(card.name) ?? 0;
        staticComboBoosts.set(card.name, existing + staticBoost);
      }
    }
    // Log multi-combo enablers (cards in 2+ combos get disproportionately high boosts)
    const multiComboCards = [...staticComboBoosts.entries()].filter(
      ([, boost]) => boost > staticBoost
    );
    if (multiComboCards.length > 0) {
      logger.debug(
        `[DeckGen] Multi-combo enablers: ${multiComboCards.map(([name, boost]) => `${name} (${boost / staticBoost} combos, ${boost}pts)`).join(', ')}`
      );
    }
    logger.debug(
      `[DeckGen] Combo priority boost applied to ${staticComboBoosts.size} unique cards from top ${combosToAttempt.length} combos (static boost: ${staticBoost}pts)`
    );
  }

  // Balanced roles tracking — declared at outer scope so return statement can access them
  let roleTargets: Record<RoleKey, number> | null = null;
  let roleTargetBreakdown: Record<RoleKey, RoleTargetBreakdown> | undefined;
  let detectedArchetype: Archetype | undefined;
  // resolvedPacing is set after edhrecData is available; detectedPacing mirrors it for the return value
  let resolvedPacing: Pacing = 'balanced';
  let detectedPacing: Pacing = 'balanced';
  let swapCandidates: Record<string, ScryfallCard[]> | undefined;
  // Land count: resolved once (flat default or archetype-aware auto-tune) so
  // the actual generation math and the post-generation grader agree on the
  // same target — see computeGradeAndBracket call below.
  let resolvedLandCount = customization.landCount;
  let landCountNote: string | undefined;
  // Whether the auto-tune actually changed the land count (decided early,
  // needs EDHREC pool data before any card is picked) — the note *text* is
  // composed later from final state (see landCountNote assembly near the
  // return) so it never disagrees with what actually shipped.
  let landCountAutoTuned = false;
  let edhrecRampCountForNote: number | undefined;
  // True when detectedArchetype came only from the oracle-text keyword-vote
  // heuristic (commanderProfile.primaryArchetype) — neither the user's own
  // theme picks nor EDHREC's own ranked commander-page themes resolved to a
  // real archetype. Softens landCountNote's copy in that low-confidence case.
  let archetypeIsLowConfidence = false;
  // Combo-completion budget disclosure: how many combo-audit/combo-floor
  // candidates were skipped for exceeding the budget cap (see budgetNote below).
  let comboBudgetSkipCount = 0;

  // Process must-include cards FIRST — they get priority over all other selections
  // Track where each must-include came from (first source wins)

  // Persistent user must-includes
  for (const name of customization.mustIncludeCards || []) {
    addMustInclude(name, 'user');
  }
  // Applied include user lists
  for (const ref of customization.appliedIncludeLists || []) {
    if (ref.enabled) {
      const list = userLists.find((l) => l.id === ref.listId);
      if (list) {
        for (const name of list.cards) {
          addMustInclude(name, 'user');
        }
      }
    }
  }
  // Optimization deck cards (from build-from-deck flow)
  if (context.optimizeDeckCards && context.optimizeDeckCards.length > 0) {
    for (const name of context.optimizeDeckCards) {
      addMustInclude(name, 'deck');
    }
  }
  // Temporary must-include cards (from combo panel)
  const tempIncludes = customization.tempMustIncludeCards ?? [];
  if (tempIncludes.length > 0) {
    logger.debug(`[DeckGen] Temp must-include cards:`, tempIncludes);
    for (const name of tempIncludes) {
      addMustInclude(name, 'combo');
    }
  }

  if (mustIncludeNames.length > 0) {
    onProgress?.('Adding your picks…', 3);
    logger.debug(
      `[DeckGen] Processing ${mustIncludeNames.length} must-include cards:`,
      mustIncludeNames
    );

    const mustIncludeMap = await getCardsByNames(mustIncludeNames, undefined, preferredSet);
    let addedCount = 0;

    for (const name of mustIncludeNames) {
      const card = mustIncludeMap.get(name);
      if (!card) {
        logger.warn(`[DeckGen] Must-include card not found: "${name}"`);
        continue;
      }

      // Skip combo-sourced cards not in collection when using full collection mode
      if (
        constrainsToCollection(collectionStrategy) &&
        mustIncludeSources.get(name) === 'combo' &&
        notInCollection(name, context.collectionNames)
      ) {
        logger.debug(`[DeckGen] Must-include combo card "${name}" skipped (not in collection)`);
        continue;
      }

      // Skip cards that don't fit the commander's color identity
      if (!fitsColorIdentity(card, colorIdentity)) {
        logger.debug(`[DeckGen] Must-include card "${name}" skipped (color identity mismatch)`);
        continue;
      }

      // Skip cards that exceed the max rarity limit
      if (!isOwnedRarityExempt(name, context.collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, maxRarity)) {
          logger.warn(
            `[DeckGen] Must-include card "${name}" skipped (rarity "${card.rarity}" exceeds max "${maxRarity}")`
          );
          continue;
        }
      }

      // Skip non-land cards that exceed the CMC cap (Tiny Leaders)
      if (exceedsCmcCap(card, maxCmc)) {
        logger.warn(
          `[DeckGen] Must-include card "${name}" skipped (CMC ${card.cmc} exceeds max ${maxCmc})`
        );
        continue;
      }

      // Skip cards not available on Arena when arena-only mode is enabled
      if (notOnArena(card, arenaOnly)) {
        logger.warn(`[DeckGen] Must-include card "${name}" skipped (not available on Arena)`);
        continue;
      }

      markUsed(card.name);
      card.isMustInclude = true;
      card.mustIncludeSource = mustIncludeSources.get(name) ?? 'user';
      addedCount++;

      // Categorize by front face type (handles MDFCs like "Instant // Land")
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('land')) {
        categories.lands.push(card);
      } else if (typeLine.includes('creature')) {
        categories.creatures.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('instant')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('sorcery')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('artifact')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('enchantment')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('planeswalker')) {
        categories.utility.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else {
        // Battle or other types
        categories.synergy.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      }
    }

    logger.debug(`[DeckGen] Added ${addedCount} must-include cards to deck`);

    // Cross-reference must-include cards with Scryfall game changer list
    const allAdded = Object.values(categories).flat();
    for (const card of allAdded) {
      if (card.isMustInclude && state.gameChangerNames.has(card.name)) {
        card.isGameChanger = true;
        gameChangerCount.value++;
      }
    }
    if (gameChangerCount.value > 0) {
      logger.debug(`[DeckGen] ${gameChangerCount.value} must-include card(s) are game changers`);
    }
  }

  // Emergent combo-completion disclosure baseline: snapshot combo
  // completeness right here, after must-includes are seeded but before the
  // main picking loop runs. Diffed later (near refreshComboCompleteness)
  // against the truly-final detectedCombos so the report can single out
  // combos the algorithm's OWN picks completed, not ones the user's
  // must-includes already brought.
  state.baselineDetectedCombos = detectCombosPhase(state);

  // Alternative generators: synthesize the candidate pool from Scryfall instead
  // of EDHREC. Populates state.edhrecData so the entire pipeline below runs
  // unchanged; selectedThemes are ignored (the UI hides the theme picker here).
  if (!usingCache && mode !== 'edhrec') {
    altPool = await buildAlternatePool(mode, customization, colorIdentity, onProgress);
    state.edhrecData = altPool.data;
    state.dataSource = altPool.dataSource;
    // Append the pool's EFFECTIVE constraint (e.g. the relaxed historical year)
    // so the strict printing upgrade + fallback fills match what was fetched.
    if (altPool.effectiveConstraint) {
      scryfallQuery = [scryfallQuery.trim(), altPool.effectiveConstraint].filter(Boolean).join(' ');
    }
    if (altPool.poolSize === 0) {
      logger.warn(
        `[DeckGen] Alternative pool (${mode}) returned no cards — falling back to Scryfall-only fill.`
      );
      // Surface it in the report rather than leaving the user with a basics pile.
      altPool = {
        ...altPool,
        relaxedNote:
          altPool.relaxedNote ??
          (mode === 'art-theme'
            ? 'No cards matched that motif in your colors — we built by function instead.'
            : 'That pool came up empty — we filled the deck by function instead.'),
      };
    }
  }
  // Try to fetch EDHREC data (works for all formats) — skip on cache hit
  else if (!usingCache && selectedThemesWithSlugs.length > 0) {
    // Fetch theme-specific data for all selected themes
    onProgress?.('Consulting the Oracle…', 8);
    try {
      // If hyper focus is on, also fetch base commander data in parallel to compare
      const baseDataPromise = customization.hyperFocus
        ? (partnerCommander
            ? fetchPartnerCommanderData(
                commander.name,
                partnerCommander.name,
                budgetOption,
                targetBracket
              )
            : fetchCommanderData(commander.name, budgetOption, targetBracket)
          ).catch(() => null)
        : Promise.resolve(null);

      // Catch each theme fetch individually so one theme's 404/network error
      // doesn't discard the themes that succeeded (F14). We fall back to base
      // commander data only if EVERY theme fetch fails (below).
      const [themeMergeResult, fetchedBaseData] = await Promise.all([
        fetchMergedThemeData(
          selectedThemesWithSlugs,
          commander.name,
          partnerCommander?.name,
          budgetOption,
          targetBracket
        ),
        baseDataPromise,
      ]);
      state.baseData = fetchedBaseData;

      if (!themeMergeResult) {
        throw new Error('All theme-specific EDHREC fetches failed');
      }

      let mergedCardlists = themeMergeResult.data.cardlists;
      state.themeOverlapCounts = themeMergeResult.themeOverlapCounts;
      let representativeStats = themeMergeResult.data.stats;
      let dataSource: DeckDataSource = targetBracket ? 'theme+bracket' : 'theme';

      if (targetBracket && isPoolTooThin(themeMergeResult.data)) {
        // E93: a bracket-narrowed theme page can resolve to a statistically
        // thin (or entirely empty) pool while still parsing as valid JSON.
        // Ladder down to a broader page rather than silently generate off
        // noise — but theme outranks bracket-only: the user explicitly
        // picked this theme, so it's the deck's identity, while the target
        // bracket's power semantics (permissions/ceilings below) survive
        // untouched regardless of which page supplied the pool. Dropping the
        // theme first (bracket-only) would silently swap "the theme deck the
        // user asked for" for "a goodstuff deck at the right power level" —
        // the exact failure this fix exists to prevent. So: theme+bracket →
        // theme (no bracket) → bracket-only → plain commander page.
        let noBracketThemeOverlapCounts: Map<string, number> | undefined;
        const outcome = await fetchPoolWithFallback([
          { source: 'theme+bracket', fetch: () => Promise.resolve(themeMergeResult.data) },
          {
            source: 'theme',
            fetch: async () => {
              const noBracket = await fetchMergedThemeData(
                selectedThemesWithSlugs,
                commander.name,
                partnerCommander?.name,
                budgetOption,
                undefined
              );
              if (!noBracket) throw new Error('theme-only EDHREC fetch failed');
              // Stash the counts but don't commit to state yet — this rung
              // may still turn out thin and the ladder moves on, in which
              // case these counts would describe a page that isn't the pool.
              noBracketThemeOverlapCounts = noBracket.themeOverlapCounts;
              return noBracket.data;
            },
          },
          {
            source: 'base+bracket',
            fetch: () =>
              partnerCommander
                ? fetchPartnerCommanderData(
                    commander.name,
                    partnerCommander.name,
                    budgetOption,
                    targetBracket
                  )
                : fetchCommanderData(commander.name, budgetOption, targetBracket),
          },
          {
            source: 'base',
            fetch: () =>
              partnerCommander
                ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
                : fetchCommanderData(commander.name, budgetOption),
          },
        ]);
        if (outcome) {
          mergedCardlists = outcome.data.cardlists;
          representativeStats = outcome.data.stats;
          dataSource = outcome.source;
          // Only commit the theme-only overlap counts if the ladder actually
          // settled on that rung — otherwise leave the theme+bracket counts
          // already assigned above (or whatever an earlier rung set).
          if (outcome.source === 'theme' && noBracketThemeOverlapCounts) {
            state.themeOverlapCounts = noBracketThemeOverlapCounts;
          }
          if (outcome.fellBackFrom) {
            logger.warn(
              `[DeckGen] E93: theme+bracket pool too thin, laddered down to "${outcome.source}"`
            );
            const commanderLabel = partnerCommander
              ? `${commander.name} // ${partnerCommander.name}`
              : commander.name;
            state.bracketPoolFallbackNote = buildBracketPoolFallbackNote(
              commanderLabel,
              targetBracket,
              outcome.fellBackFrom,
              outcome.source,
              selectedThemesWithSlugs.map((t) => t.name).join(', ')
            );
          }
        }
        // outcome === null means every rung's fetch threw — keep the original
        // thin-but-parsed theme+bracket pool computed above rather than nothing.
      } else if (!representativeStats.numDecks || representativeStats.numDecks === 0) {
        // Pre-E93 behavior, unchanged: no bracket was targeted, but the theme
        // endpoint parsed fine while lacking type-distribution stats — patch
        // stats only from the base page (the cardlist itself is still used).
        logger.warn(
          '[DeckGen] FALLBACK: Theme endpoint lacks stats (numDecks=0), fetching base commander stats'
        );
        try {
          const baseStatsData = partnerCommander
            ? await fetchPartnerCommanderData(
                commander.name,
                partnerCommander.name,
                budgetOption,
                targetBracket
              )
            : await fetchCommanderData(commander.name, budgetOption, targetBracket);
          representativeStats = baseStatsData.stats;
          logger.debug('[DeckGen] FALLBACK: Got stats from base commander+bracket');
        } catch {
          if (targetBracket) {
            logger.warn(
              '[DeckGen] FALLBACK: Base commander+bracket stats failed, trying without bracket'
            );
            try {
              const fallbackData = partnerCommander
                ? await fetchPartnerCommanderData(
                    commander.name,
                    partnerCommander.name,
                    budgetOption
                  )
                : await fetchCommanderData(commander.name, budgetOption);
              representativeStats = fallbackData.stats;
              logger.debug('[DeckGen] FALLBACK: Got stats from base commander (no bracket)');
            } catch {
              logger.warn(
                '[DeckGen] FALLBACK: All stats fetches failed — will use fallback type targets'
              );
            }
          } else {
            logger.warn(
              '[DeckGen] FALLBACK: Base commander stats fetch failed — will use fallback type targets'
            );
          }
        }
      }

      state.edhrecData = {
        themes: [],
        stats: representativeStats,
        cardlists: mergedCardlists,
        similarCommanders: [],
      };

      state.dataSource = dataSource;
      const themeNames = selectedThemesWithSlugs.map((t) => t.name).join(', ');
      onProgress?.(`Attuning to ${themeNames}…`, 12);
    } catch (error) {
      logger.warn(
        '[DeckGen] FALLBACK: Theme-specific EDHREC fetch failed, trying base commander+bracket:',
        error
      );
      // Fall back to base commander data (with bracket)
      try {
        state.edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(
              commander.name,
              partnerCommander.name,
              budgetOption,
              targetBracket
            )
          : await fetchCommanderData(commander.name, budgetOption, targetBracket);
        state.dataSource = targetBracket ? 'base+bracket' : 'base';
        logger.debug('[DeckGen] FALLBACK: Using base commander data (with bracket)');
        onProgress?.('Consulting the Oracle…', 12);
      } catch {
        // Fall back to base commander without bracket
        if (targetBracket) {
          logger.warn(
            '[DeckGen] FALLBACK: Base commander+bracket also failed, trying without bracket'
          );
          try {
            state.edhrecData = partnerCommander
              ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
              : await fetchCommanderData(commander.name, budgetOption);
            state.dataSource = 'base';
            logger.debug('[DeckGen] FALLBACK: Using base commander data (no bracket)');
            onProgress?.('Consulting the Oracle…', 12);
          } catch {
            logger.warn(
              '[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation'
            );
            onProgress?.('Scrying for more…', 12);
          }
        } else {
          logger.warn(
            '[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation'
          );
          onProgress?.('Scrying for more…', 12);
        }
      }
    }
  } else if (!usingCache) {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Consulting the Oracle…', 8);
    if (targetBracket) {
      // E93: ladder bracket-only → plain commander page when the bracket page
      // is too thin to build from. This also subsumes the pre-E93 error-only
      // fallback below (a thrown fetch is just a rung with no data).
      const outcome = await fetchPoolWithFallback([
        {
          source: 'base+bracket',
          fetch: () =>
            partnerCommander
              ? fetchPartnerCommanderData(
                  commander.name,
                  partnerCommander.name,
                  budgetOption,
                  targetBracket
                )
              : fetchCommanderData(commander.name, budgetOption, targetBracket),
        },
        {
          source: 'base',
          fetch: () =>
            partnerCommander
              ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
              : fetchCommanderData(commander.name, budgetOption),
        },
      ]);
      if (outcome) {
        state.edhrecData = outcome.data;
        state.dataSource = outcome.source;
        if (outcome.fellBackFrom) {
          logger.warn(
            `[DeckGen] E93: bracket-only pool too thin, laddered down to "${outcome.source}"`
          );
          const commanderLabel = partnerCommander
            ? `${commander.name} // ${partnerCommander.name}`
            : commander.name;
          state.bracketPoolFallbackNote = buildBracketPoolFallbackNote(
            commanderLabel,
            targetBracket,
            outcome.fellBackFrom,
            outcome.source,
            undefined
          );
        }
        onProgress?.('Your commander heeds the call…', 12);
      } else {
        logger.warn(
          '[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation'
        );
        onProgress?.('Scrying for more…', 12);
      }
    } else {
      try {
        state.edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
          : await fetchCommanderData(commander.name, budgetOption);
        state.dataSource = 'base';
        onProgress?.('Your commander heeds the call…', 12);
      } catch {
        logger.warn(
          '[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation'
        );
        onProgress?.('Scrying for more…', 12);
      }
    }
  }

  // ── Salt tolerance: filter or boost based on EDHREC salt scores ──
  // EDHREC's cardlist payloads don't carry per-card salt, so we fetch the
  // top-100 saltiest cards from `top/salt.json` and use that as the index.
  // Cards not in the index are treated as ~0 salt (not salty enough to matter).
  let saltIndex: Map<string, number> = new Map();
  const saltTolerance = customization.saltTolerance ?? 2;
  // 0 = unsalted (strict), 1 = low (moderate), 2 = neutral, 3 = extra (boost)
  const saltCap = saltTolerance === 0 ? 0.75 : saltTolerance === 1 ? 2.0 : Infinity;
  // Fetched even with no EDHREC data when a cap is active (soft-fails to an
  // empty map) so the salt gate below still covers Scryfall-only fills.
  if (state.edhrecData || saltCap !== Infinity) {
    saltIndex = await fetchSaltIndex();
  }
  const saltMustInclude = new Set(customization.mustIncludeCards ?? []);
  const saltFor = (name: string): number | undefined => {
    const direct = saltIndex.get(name);
    if (direct !== undefined) return direct;
    if (name.includes(' // ')) return saltIndex.get(frontFaceName(name));
    return undefined;
  };
  // Shared salt hard gate for paths that don't read the (trimmed) EDHREC
  // cardlists — Scryfall fallback fills and lift package picks (E71 controls
  // audit). undefined when no cap is active, so those paths skip the check.
  const isSaltBlocked =
    saltCap === Infinity
      ? undefined
      : (name: string): boolean => {
          if (saltMustInclude.has(name)) return false;
          const salt = saltFor(name);
          return salt !== undefined && salt > saltCap;
        };
  if (state.edhrecData) {
    if (saltTolerance !== 2) {
      const filterFn = (card: EDHRECCard): boolean => !isSaltBlocked?.(card.name);
      let trimmed = 0;
      const filterList = (list: EDHRECCard[]): EDHRECCard[] => {
        const next = list.filter(filterFn);
        trimmed += list.length - next.length;
        return next;
      };
      if (saltTolerance === 3) {
        // Embrace salt: bump inclusion of salty cards so they sort higher.
        // Bump scales with how salty the card is (cap at +60 for very salty).
        for (const list of Object.values(state.edhrecData.cardlists)) {
          for (const card of list) {
            const salt = saltFor(card.name);
            if (salt !== undefined && salt > 1.0) {
              card.inclusion = (card.inclusion ?? 0) + Math.min(60, salt * 20);
            }
          }
        }
        logger.debug('[DeckGen] Salt tolerance "extra": boosting high-salt cards');
      } else {
        state.edhrecData.cardlists.creatures = filterList(state.edhrecData.cardlists.creatures);
        state.edhrecData.cardlists.instants = filterList(state.edhrecData.cardlists.instants);
        state.edhrecData.cardlists.sorceries = filterList(state.edhrecData.cardlists.sorceries);
        state.edhrecData.cardlists.artifacts = filterList(state.edhrecData.cardlists.artifacts);
        state.edhrecData.cardlists.enchantments = filterList(
          state.edhrecData.cardlists.enchantments
        );
        state.edhrecData.cardlists.planeswalkers = filterList(
          state.edhrecData.cardlists.planeswalkers
        );
        state.edhrecData.cardlists.lands = filterList(state.edhrecData.cardlists.lands);
        state.edhrecData.cardlists.allNonLand = filterList(state.edhrecData.cardlists.allNonLand);
        logger.debug(
          `[DeckGen] Salt tolerance "${saltTolerance}" (cap ${saltCap}): trimmed ${trimmed} card slots`
        );
      }
    }
  }

  // Build hyper focus boost map if enabled (runs with cached or fresh data)
  if (state.edhrecData && customization.hyperFocus && selectedThemesWithSlugs.length >= 1) {
    const baseCardNames = new Set<string>();
    if (state.baseData) {
      for (const list of Object.values(state.baseData.cardlists)) {
        for (const card of list) {
          baseCardNames.add(card.name);
        }
      }
    }

    const allThemeCards = [
      ...state.edhrecData.cardlists.creatures,
      ...state.edhrecData.cardlists.instants,
      ...state.edhrecData.cardlists.sorceries,
      ...state.edhrecData.cardlists.artifacts,
      ...state.edhrecData.cardlists.enchantments,
      ...state.edhrecData.cardlists.planeswalkers,
    ];

    if (selectedThemesWithSlugs.length === 1) {
      let boosted = 0,
        penalized = 0;
      for (const card of allThemeCards) {
        const synergy = card.synergy ?? 0;
        const inBase = baseCardNames.has(card.name);

        if (!inBase && synergy >= 0.1) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 1000);
          boosted++;
        } else if (!inBase) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 500);
          boosted++;
        } else if (inBase && synergy >= 0.3) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 200);
          boosted++;
        } else if (inBase && synergy < 0.1) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) - 500);
          penalized++;
        }
      }
      logger.debug(
        `[DeckGen] Hyper Focus (single theme, base pool: ${baseCardNames.size} cards): boosted ${boosted}, penalized ${penalized}`
      );
    } else {
      const numThemes = selectedThemesWithSlugs.length;
      for (const [name, count] of state.themeOverlapCounts) {
        const inBase = baseCardNames.has(name);
        let boost = 0;
        if (count === 1 && !inBase) {
          boost = 1000;
        } else if (count === 1) {
          boost = 300;
        } else if (count >= numThemes || inBase) {
          boost = -500;
        } else {
          boost = -200 * (count - 1);
        }
        staticComboBoosts.set(name, (staticComboBoosts.get(name) ?? 0) + boost);
      }
      logger.debug(
        `[DeckGen] Hyper Focus (${numThemes} themes, base pool: ${baseCardNames.size} cards): adjusted ${state.themeOverlapCounts.size} cards`
      );
    }
  }

  // Populate generation cache after successful EDHREC fetch
  if (!usingCache && state.edhrecData) {
    const key = buildCacheKey(context);
    generationCache = {
      edhrecData: state.edhrecData,
      baseData: state.baseData,
      cardMap: new Map(), // Will be populated after Scryfall batch fetch
      themeOverlapCounts: state.themeOverlapCounts,
      combos: state.combos,
      gameChangerNames: state.gameChangerNames,
      dataSource: state.dataSource,
      bracketPoolFallbackNote: state.bracketPoolFallbackNote,
      representativeStats: state.edhrecData.stats,
      ...key,
    };
    logger.debug('[DeckGen] Generation cache populated for fast regeneration');
  }

  // Resolve pacing: user override > auto-detect from EDHREC stats > fallback
  if (!customization.tempoAutoDetect) {
    resolvedPacing = customization.tempoPacing;
  } else if (state.edhrecData?.stats?.manaCurve) {
    resolvedPacing = estimatePacingFromStats(state.edhrecData.stats.manaCurve);
  }
  detectedPacing = resolvedPacing;

  // Commander profile (mechanically detected archetype/tribes/abilities from
  // oracle text) — the fallback for theme-inference, and the input to the
  // archetype-aware land count below. Computed once, unconditionally (not
  // gated behind balancedRoles): a tribal/spellslinger/enchantress commander
  // should get its real archetype and land count regardless of that toggle.
  const commanderProfile = buildCommanderProfile(commander, partnerCommander);
  // Prefer EDHREC's own ranked commander-page themes (the community's stated
  // consensus) over the oracle-text keyword-vote heuristic, which tie-breaks
  // on a static precedence list and mislabels commanders like Atraxa
  // ("voltron" instead of proliferate/superfriends) or Sythis ("spellslinger"
  // instead of enchantress). Only when EDHREC has nothing to say does the
  // keyword vote decide — and that fallback path is the low-confidence case
  // landCountNote's copy softens below.
  const edhrecThemeArchetype = inferArchetypeFromEdhrecThemes(state.edhrecData?.themes);
  // EDHREC theme data existing but not dominant (a genuinely split-strategy
  // commander, e.g. Atraxa) is different from EDHREC having no data at all
  // (fetch failed / offline / Scryfall-only generation). In the first case,
  // don't let the coarse structural-keyword vote assert a specific — and
  // possibly wrong — strategy (it pegs Atraxa as VOLTRON); default to the
  // neutral GOODSTUFF instead. The keyword vote remains the only signal, and
  // stays unchanged, when there's no EDHREC theme data to consult at all.
  const hasEdhrecThemeData = (state.edhrecData?.themes?.length ?? 0) > 0;
  const archetypeFallback =
    edhrecThemeArchetype ??
    (hasEdhrecThemeData ? Archetype.GOODSTUFF : commanderProfile.primaryArchetype);
  archetypeIsLowConfidence =
    edhrecThemeArchetype === undefined && !context.selectedThemes?.some((t) => t.isSelected);
  detectedArchetype = inferArchetype(context.selectedThemes, archetypeFallback);

  // Archetype-aware land count: only when the user hasn't customized land
  // inputs (still at the store defaults) — an explicit user choice is never
  // second-guessed. Uses the EDHREC-typical ramp count for this commander
  // (a pre-generation proxy for dork/rock density) + the EDHREC average CMC.
  if (isDefaultLandCount(customization) && state.edhrecData) {
    const edhrecRampCount = computeEdhrecRoleTargets(state.edhrecData).ramp;
    const manaCurve = state.edhrecData.stats?.manaCurve ?? {};
    const curveTotal = Object.values(manaCurve).reduce((s, v) => s + v, 0);
    const avgCmc =
      curveTotal > 0
        ? Object.entries(manaCurve).reduce((s, [cmc, count]) => s + Number(cmc) * count, 0) /
          curveTotal
        : 0;
    const autoLandCount = computeAutoLandCount(detectedArchetype, edhrecRampCount, avgCmc);
    if (autoLandCount !== resolvedLandCount) {
      resolvedLandCount = autoLandCount;
      landCountAutoTuned = true;
      edhrecRampCountForNote = edhrecRampCount;
    }
  }

  // E88: when the auto-tune RAISES land count above the 37-land baseline, size
  // the type passes as if lands were still at baseline — so they pick their
  // full, un-squeezed complement (including the marginal roleless-premium
  // cards that would otherwise never be tried) — and let
  // phaseLandSqueezeReconcile (just before Smart Trim, below) reconcile the
  // resulting surplus down to the real land count, globally, disclosed, and
  // with the SAME protection tiers (must-include/staple/protection-piece/
  // combo/role) Smart Trim already carries. Only the "shrink nonland budget"
  // direction needs this — when the auto-tune LOWERS land count, the deck is
  // genuinely short and the existing generic shortage-fill path already
  // handles it gracefully by ADDING marginal picks, which has no casualty
  // problem.
  const typeTargetLandCount = landCountAutoTuned
    ? Math.min(resolvedLandCount, DEFAULT_LAND_COUNT)
    : resolvedLandCount;

  // Calculate target counts with type and curve targets
  const {
    composition: targets,
    typeTargets,
    curveTargets,
  } = calculateTargetCounts(
    customization,
    state.edhrecData?.stats,
    !!partnerCommander,
    resolvedPacing,
    resolvedLandCount,
    typeTargetLandCount
  );

  // Archetype identity floor on top of EDHREC's purely stats-driven type
  // targets (e.g. a spellslinger commander needs a real instant/sorcery
  // density even if its EDHREC page sample skews creature-heavy). Skipped
  // when the user set explicit type percentages — an explicit choice is
  // never second-guessed.
  if (!customization.advancedTargets?.typePercentages) {
    const nonLandTotalForFloor = Object.values(typeTargets).reduce((s, v) => s + v, 0);
    applyArchetypeTypeFloor(
      typeTargets,
      detectedArchetype ?? Archetype.GOODSTUFF,
      nonLandTotalForFloor
    );
  }

  // Compress curve targets for Tiny Leaders (CMC cap at 3)
  if (maxCmc !== null) {
    const totalNonLand = Object.values(curveTargets).reduce((s, v) => s + v, 0);
    // Redistribute all slots into 0..maxCmc buckets
    const compressed: Record<number, number> = {};
    for (let i = 0; i <= maxCmc; i++) compressed[i] = 0;
    // Keep existing counts for buckets within cap
    for (const [cmcStr, count] of Object.entries(curveTargets)) {
      const cmc = parseInt(cmcStr);
      if (cmc <= maxCmc) {
        compressed[cmc] = count;
      }
    }
    // Redistribute overflow into the capped buckets proportionally
    const kept = Object.values(compressed).reduce((s, v) => s + v, 0);
    const overflow = totalNonLand - kept;
    if (overflow > 0) {
      // Weight toward the top of the range (CMC 2-3 for Tiny Leaders)
      const weights: Record<number, number> = {};
      for (let i = 0; i <= maxCmc; i++) weights[i] = i === 0 ? 0.05 : i / maxCmc;
      const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
      let distributed = 0;
      for (let i = 0; i <= maxCmc; i++) {
        const extra = Math.round(overflow * (weights[i] / totalWeight));
        compressed[i] += extra;
        distributed += extra;
      }
      // Fix rounding by adjusting the top bucket
      compressed[maxCmc] += overflow - distributed;
    }
    // Replace curve targets
    for (const key of Object.keys(curveTargets)) delete curveTargets[parseInt(key)];
    Object.assign(curveTargets, compressed);
    logger.debug(
      '[DeckGen] Tiny Leaders: compressed curve targets to CMC <=',
      maxCmc,
      curveTargets
    );
  }

  // Debug: Log expected card counts
  const totalTypeTargets = Object.values(typeTargets).reduce((sum, v) => sum + v, 0);
  logger.debug('[DeckGen] Target type counts:', typeTargets);
  logger.debug(
    '[DeckGen] Total non-land target:',
    totalTypeTargets,
    '(should be ~',
    format === 99 ? 99 - targets.lands : format - 1 - targets.lands,
    ')'
  );
  logger.debug('[DeckGen] Target curve:', curveTargets);
  logger.debug('[DeckGen] Land target:', targets.lands);

  // Create budget tracker if deck budget is set
  const mustIncludeCards = Object.values(categories).flat();
  const nonLandSlotsTotal =
    totalTypeTargets -
    mustIncludeCards.filter((c) => !getFrontFaceTypeLine(c).toLowerCase().includes('land')).length;
  const budgetTracker =
    deckBudget !== null
      ? new BudgetTracker(
          deckBudget,
          nonLandSlotsTotal + (customization.nonBasicLandCount ?? 15),
          currency
        )
      : null;

  // Deduct must-include costs from budget (commander cost is excluded from budget)
  if (budgetTracker && mustIncludeCards.length > 0) {
    const cardsToDeduct = ignoreOwnedBudget
      ? mustIncludeCards.filter((c) => !isOwnedBudgetExempt(c.name, context.collectionNames, true))
      : mustIncludeCards;
    if (cardsToDeduct.length > 0) budgetTracker.deductMustIncludes(cardsToDeduct);
  }

  // Hoisted so fixup pass can access the Scryfall card map after generation
  let scryfallCardMap: Map<string, ScryfallCard> = new Map();
  const dependencySupportCards = () => [
    commander,
    ...(partnerCommander ? [partnerCommander] : []),
    ...Object.values(categories).flat(),
  ];
  const dependencyCommanderCount = partnerCommander ? 2 : 1;
  const isCardAllowedBySynergyDependencies = (card: ScryfallCard) =>
    !isUnsupportedSynergyPayoff(card, dependencySupportCards(), dependencyCommanderCount);

  // EDHREC lift pools (E71 slice 2): fetch intent-anchored seeds once, before
  // any card is picked, so every re-rank/tie-break point below (EDHREC picks,
  // Scryfall fallback fill, no-EDHREC fallback) shares the same data.
  // Soft-fails to no data (bails without state.edhrecData, or on a fetch
  // error) — picking below is then byte-identical to pre-lift output.
  await ensureLiftPools(state, collectEarlyLiftSeeds(state));
  const liftIndex = getLiftIndex(state);
  const liftScoreOf = (name: string) => liftIndex.get(name.toLowerCase())?.clusterScore ?? 0;
  const liftTieBreak = new Map([...liftIndex].map(([name, entry]) => [name, entry.clusterScore]));

  // Bracket band guardrail: cap per-card floor signals (game changers, MLD,
  // extra turns, stax) so the deck lands at/under the target bracket by
  // construction instead of overshooting and being patched post-gen. Hoisted
  // above the EDHREC/Scryfall-only branch so both paths share ONE guard —
  // counts accumulate across picking phases and fallback fills alike.
  // undefined (zero per-pick overhead) when no bracket is targeted or the
  // target is high enough that no ceiling binds.
  const bracketCeil = bracketCeilings(targetBracket);
  const bracketGuard = ceilingsAreOpen(bracketCeil)
    ? undefined
    : new BracketGuard(bracketCeil, state.gameChangerNames);
  // Hard gates threaded into every fillWithScryfall call (E71 controls audit):
  // the fallback fill enforces the same salt / game-changer-cap / bracket-
  // ceiling gates as the EDHREC-pool picker, sharing its running counts.
  const fillGates: FillHardGates = {
    isSaltBlocked,
    bracketGuard,
    gameChangerNames: state.gameChangerNames,
    gameChangerCount,
    maxGameChangers,
  };
  // Aggregate, generation-wide count of role-cap escape-hatch admissions —
  // every gated path (pick loop, Scryfall fallback, shortage backfill, owned
  // substitutes) increments this so ONE build-report note can disclose it
  // (see roleCapOverflowNote below), instead of firing invisibly.
  const roleCapOverflowCounts: Partial<Record<RoleKey, number>> = {};
  // E80: unordered name-pairs the price-sanity tie-break actually decided
  // (see pickFromPrefetchedWithCurve's priceSanityDecided doc) — aggregated
  // across every type pass so ONE build-report note can disclose it.
  const priceSanityDecided = new Set<string>();
  // Role-cap-augmented gates for the shortage-backfill call sites the brief
  // wants role-aware (E77 iter-4) — evaluated lazily (not baked into the
  // shared `fillGates` object) since `roleTargets` isn't resolved until
  // later, and NOT applied to the no-EDHREC-data / direct-role-bucket fills,
  // which fill a role bucket to its OWN target by construction.
  const fillGatesWithRoleCap = (): FillHardGates =>
    roleTargets
      ? {
          ...fillGates,
          roleCap: { roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts },
        }
      : fillGates;

  // ---- Multi-copy card pipeline (self-contained, no impact if nothing found) ----
  if (state.edhrecData) {
    const allEdhrecNames = state.edhrecData.cardlists.allNonLand.map((c) => c.name);
    const firstThemeSlug =
      selectedThemesWithSlugs.length > 0 ? selectedThemesWithSlugs[0].slug : undefined;
    const multiCopyResults = await resolveMultiCopyCards(
      allEdhrecNames,
      commander.name,
      firstThemeSlug,
      usedNames,
      format === 99 ? 100 : format, // EDHREC uses 100-card decks
      bannedCards,
      maxCardPrice,
      maxRarity,
      currency,
      context.collectionNames,
      context.collectionAvailableCounts,
      collectionStrategy,
      ignoreOwnedRarity,
      budgetTracker,
      ignoreOwnedBudget
    );

    for (const { card, copies } of multiCopyResults) {
      // Categorize by front-face type (same pattern as must-includes)
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('land')) {
        categories.lands.push(...copies);
      } else if (typeLine.includes('creature')) {
        categories.creatures.push(...copies);
      } else if (typeLine.includes('instant')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('sorcery')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('artifact')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('enchantment')) {
        categorizeCards(copies, categories);
      } else {
        categories.synergy.push(...copies);
      }

      // Update curve counts
      const cmc = Math.min(Math.floor(card.cmc), 7);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + copies.length;

      // Deduct from budget
      if (budgetTracker) {
        for (const copy of copies) {
          budgetTracker.deductCard(copy);
        }
      }

      // Prevent normal selection from picking this card again
      markUsed(card.name);
    }
  }
  // ---- End multi-copy pipeline ----

  // Count non-land cards already added (must-includes + multi-copy) by card type
  // so we can reduce type targets and avoid overfilling the deck
  const preFilledTypeCounts: Record<string, number> = {};
  for (const card of Object.values(categories).flat()) {
    const type = getSimpleCardType(getFrontFaceTypeLine(card).toLowerCase());
    if (type) {
      preFilledTypeCounts[type] = (preFilledTypeCounts[type] ?? 0) + 1;
    }
  }
  if (Object.keys(preFilledTypeCounts).length > 0) {
    logger.debug(
      '[DeckGen] Pre-filled type counts (must-include + multi-copy):',
      preFilledTypeCounts
    );
  }

  // If we have EDHREC data, use it as the primary source with CMC-aware selection
  if (state.edhrecData && state.edhrecData.cardlists.allNonLand.length > 0) {
    const { cardlists } = state.edhrecData;

    // Build all pools first — subtract pre-filled cards from targets
    // Use ?? instead of || so that 0 targets (from advanced overrides) are respected
    const originalCreatureTarget = typeTargets.creature ?? targets.creatures;
    const creatureTarget = Math.max(
      0,
      originalCreatureTarget - (preFilledTypeCounts.creature ?? 0)
    );
    const creaturePool = mergeWithAllNonLand(
      cardlists.creatures,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );
    const instantTarget = Math.max(
      0,
      (typeTargets.instant ?? 0) - (preFilledTypeCounts.instant ?? 0)
    );
    const instantPool = mergeWithAllNonLand(
      cardlists.instants,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );
    const sorceryTarget = Math.max(
      0,
      (typeTargets.sorcery ?? 0) - (preFilledTypeCounts.sorcery ?? 0)
    );
    const sorceryPool = mergeWithAllNonLand(
      cardlists.sorceries,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );
    const artifactTarget = Math.max(
      0,
      (typeTargets.artifact ?? 0) - (preFilledTypeCounts.artifact ?? 0)
    );
    const artifactPool = mergeWithAllNonLand(
      cardlists.artifacts,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );
    const enchantmentTarget = Math.max(
      0,
      (typeTargets.enchantment ?? 0) - (preFilledTypeCounts.enchantment ?? 0)
    );
    const enchantmentPool = mergeWithAllNonLand(
      cardlists.enchantments,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );
    const planeswalkerTarget = Math.max(
      0,
      (typeTargets.planeswalker ?? 0) - (preFilledTypeCounts.planeswalker ?? 0)
    );
    const planeswalkerPool = mergeWithAllNonLand(
      cardlists.planeswalkers,
      cardlists.allNonLand,
      state.cfg.brewLevel
    );

    // Collect ALL unique card names from all pools for a single batch fetch
    onProgress?.('Searching your library…', 18);
    const allCardNames = new Set<string>();

    // Helper to add names from a pool
    // IMPORTANT: Fetch ALL typed cards first (they're from EDHREC's type-specific lists),
    // then add high synergy Unknown cards. This ensures we actually have cards of the right type.
    const addPoolNames = (pool: EDHRECCard[], target: number) => {
      const candidates = pool.filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name));

      // First, add ALL typed cards (these are confirmed to be the right type by EDHREC)
      const typedCards = candidates.filter((c) => c.primary_type !== 'Unknown');
      for (const card of typedCards.slice(0, Math.max(target * 3 + 15, 35))) {
        allCardNames.add(card.name);
      }

      // Then add high synergy Unknown cards (need type check via Scryfall later)
      const highSynergyUnknown = candidates.filter(
        (c) => c.primary_type === 'Unknown' && isHighSynergyCard(c)
      );
      for (const card of highSynergyUnknown.slice(0, Math.max(target * 2 + 15, 30))) {
        allCardNames.add(card.name);
      }
    };

    addPoolNames(creaturePool, creatureTarget);
    addPoolNames(instantPool, instantTarget);
    addPoolNames(sorceryPool, sorceryTarget);
    addPoolNames(artifactPool, artifactTarget);
    addPoolNames(enchantmentPool, enchantmentTarget);
    addPoolNames(planeswalkerPool, planeswalkerTarget);

    // Ensure combo piece cards are included in the batch fetch
    for (const name of comboCardNames) {
      allCardNames.add(name);
    }

    logger.debug(`[DeckGen] Batch fetching ${allCardNames.size} unique card names`);

    // SINGLE BATCH FETCH for all non-land cards
    onProgress?.('Scrying the multiverse…', 25);
    const cardMap = await getCardsByNames(
      [...allCardNames],
      (fetched, total) => {
        // Scale progress from 25% to 35% during the batch fetch
        const pct = 25 + Math.round((fetched / total) * 10);
        onProgress?.('Scrying the multiverse…', pct);
      },
      preferredSet
    );
    // Post-filter: remove cards that don't match the scryfallQuery filter
    if (preferredSet) {
      for (const [name, card] of cardMap) {
        if (card.set !== preferredSet) cardMap.delete(name);
      }
    }
    await upgradeCardPrintings(cardMap, scryfallQuery, true);
    logger.debug(`[DeckGen] Batch fetch returned ${cardMap.size} cards (after filtering)`);
    scryfallCardMap = cardMap;

    // Update generation cache with the cardMap (not used on fast path currently,
    // but kept for potential future use)
    if (generationCache) {
      generationCache.cardMap = cardMap;
    }

    // MDFC land boost: prioritize spell/land MDFCs in spell pools.
    // These are strictly better than their spell-only equivalents since they can
    // also be played as lands.
    let mdfcLandCount = 0;
    for (const [name, card] of cardMap) {
      if (isMdfcLand(card)) {
        card.isMdfcLand = true;
        const existing = staticComboBoosts.get(name) ?? 0;
        staticComboBoosts.set(name, existing + MDFC_LAND_BOOST);
        mdfcLandCount++;
      }
    }
    if (mdfcLandCount > 0) {
      logger.debug(
        `[DeckGen] MDFC land boost applied to ${mdfcLandCount} spell/land cards (+${MDFC_LAND_BOOST} priority)`
      );
    }

    // Channel land boost: Kamigawa channel lands are near-auto-includes —
    // enter untapped and offer a free spell mode via discard.
    let channelLandCount = 0;
    for (const [name, card] of cardMap) {
      if (isChannelLand(card)) {
        card.isChannelLand = true;
        const existing = staticComboBoosts.get(name) ?? 0;
        staticComboBoosts.set(name, existing + CHANNEL_LAND_BOOST);
        channelLandCount++;
      }
    }
    if (channelLandCount > 0) {
      logger.debug(
        `[DeckGen] Channel land boost applied to ${channelLandCount} Kamigawa lands (+${CHANNEL_LAND_BOOST} priority)`
      );
    }

    // Inject combo pieces into the correct type pools so they can actually be picked
    if (comboCardNames.size > 0) {
      const poolMap: Record<string, EDHRECCard[]> = {
        creature: creaturePool,
        instant: instantPool,
        sorcery: sorceryPool,
        artifact: artifactPool,
        enchantment: enchantmentPool,
        planeswalker: planeswalkerPool,
      };
      let injected = 0;
      for (const name of comboCardNames) {
        const scryfallCard = cardMap.get(name);
        if (!scryfallCard) continue;
        const typeLine = getFrontFaceTypeLine(scryfallCard).toLowerCase();
        if (typeLine.includes('land')) continue; // Lands are handled separately
        for (const [type, pool] of Object.entries(poolMap)) {
          if (typeLine.includes(type) && !pool.some((c) => c.name === name)) {
            pool.push({
              name,
              sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              primary_type: type.charAt(0).toUpperCase() + type.slice(1),
              inclusion: 50,
              num_decks: 100,
              synergy: 0.5,
              isThemeSynergyCard: false,
              isGameChanger: false,
            });
            injected++;
          }
        }
      }
      if (injected > 0) {
        logger.debug(`[DeckGen] Injected ${injected} combo pieces into type pools`);
      }
    }

    // ---- Balanced Roles: pre-compute role map and seed counts ----
    if (customization.advancedTargets?.roleTargets) {
      // Advanced override always takes precedence
      roleTargets = customization.advancedTargets.roleTargets as Record<RoleKey, number>;
    } else if (customization.balancedRoles) {
      const dynamic = getDynamicRoleTargets(
        format,
        context.selectedThemes,
        state.edhrecData?.stats,
        state.edhrecData,
        customization.advancedTargets?.edhrecBlendWeight ?? null,
        customization.advancedTargets?.edhrecInclusionThreshold ?? null,
        archetypeFallback // same EDHREC-theme-first fallback used above, not the raw keyword vote
      );
      roleTargets = dynamic.targets;
      detectedArchetype = dynamic.archetype; // same value already set above; kept for shape parity
      roleTargetBreakdown = dynamic.breakdown;
      // When auto-detect is on, prefer the richer archetype-aware pacing from getDynamicRoleTargets
      if (customization.tempoAutoDetect) {
        resolvedPacing = dynamic.pacing;
        detectedPacing = dynamic.pacing;
      }
    }
    const cardRoleMap = new Map<string, RoleKey>();
    const cardCmcMap = new Map<string, number>();
    const cardSubtypeMap = new Map<string, string>();

    if (roleTargets) {
      // Pre-compute roles and CMC for all candidates in all pools
      const allPools = [
        creaturePool,
        instantPool,
        sorceryPool,
        artifactPool,
        enchantmentPool,
        planeswalkerPool,
      ];
      for (const pool of allPools) {
        for (const edhrecCard of pool) {
          if (cardRoleMap.has(edhrecCard.name)) continue;
          const scryfallCard = cardMap.get(edhrecCard.name);
          if (!scryfallCard) continue;
          const role = validateCardRole(scryfallCard);
          if (role) {
            cardRoleMap.set(edhrecCard.name, role);
            cardCmcMap.set(edhrecCard.name, scryfallCard.cmc);
            const subtype = getCardSubtype(scryfallCard.name);
            if (subtype) cardSubtypeMap.set(edhrecCard.name, subtype);
            // Also store under full Scryfall name for DFCs (e.g. "A // B")
            if (scryfallCard.name !== edhrecCard.name) {
              cardRoleMap.set(scryfallCard.name, role);
              cardCmcMap.set(scryfallCard.name, scryfallCard.cmc);
              if (subtype) cardSubtypeMap.set(scryfallCard.name, subtype);
            }
          }
        }
      }

      // Seed counts from pre-filled cards (must-includes + multi-copy) and stamp roles
      for (const card of Object.values(categories).flat()) {
        const role = validateCardRole(card);
        if (role) {
          currentRoleCounts[role]++;
          card.deckRole = role;
          stampRoleSubtypes(card);
          const subtype = cardSubtypeMap.get(card.name) ?? getCardSubtype(card.name);
          if (subtype) currentSubtypeCounts[subtype] = (currentSubtypeCounts[subtype] ?? 0) + 1;
        }
      }

      logger.debug(
        `[DeckGen] Balanced Roles: ${cardRoleMap.size} candidates mapped, targets:`,
        roleTargets
      );
      logger.debug(`[DeckGen] Balanced Roles: pre-filled counts:`, { ...currentRoleCounts });
    }
    // ---- End balanced roles setup ----

    // When the user has explicitly set curve/role targets, enforce them strictly
    const strictCurve = !!customization.advancedTargets?.curvePercentages;
    const strictRoles = !!customization.advancedTargets?.roleTargets;
    // E80 product ruling: price-sanity ships as the DEFAULT (see resolvePriceSanity).
    const priceSanity = resolvePriceSanity(customization);

    // E89 (iter-7 Slice E): untap-theme visibility. commanderWantsUntap is
    // near-inert for most decks — true only when the commander (or partner)
    // either untaps things itself (isUntapProducer, e.g. Tezzeret, Cruel
    // Captain's loyalty ability) or has its own reusable {T} ability worth
    // extra activations (hasReusableTapAbility above — Urianger Augurelt's
    // Draw/Play Arcanum has no untap text at all, so the "wants untap"
    // signal for him is that his own ability is worth reusing, not that he
    // produces untaps).
    const commanderWantsUntap =
      isUntapProducer(commander) ||
      hasReusableTapAbility(commander) ||
      (!!partnerCommander &&
        (isUntapProducer(partnerCommander) || hasReusableTapAbility(partnerCommander)));

    // iter-8 Slice B: blink/flicker theme visibility. Single-clause gate —
    // both named blink commanders (Brago, Aminatou) are themselves blink
    // producers, no second helper needed (unlike untap's Urianger case).
    // Accepted miss, documented not fixed: Yarok, the Desecrated (an
    // ETB-doubler, not itself a producer) doesn't trip this — see
    // isBlinkProducer's doc comment in tagger/client.ts.
    const commanderWantsBlink =
      isBlinkProducer(commander) || (!!partnerCommander && isBlinkProducer(partnerCommander));

    // iter-8 Slice B: exile-matters (impulse draw) theme visibility.
    // Two-clause gate — producer OR payoff-identity — because the payoff
    // signal (hasExilePayoffIdentity above) is what catches Urianger
    // Augurelt, whose own text never matches isExileProducer. Prosper,
    // Tome-Bound is caught by both clauses independently.
    const commanderWantsExile =
      isExileProducer(commander) ||
      hasExilePayoffIdentity(commander) ||
      (!!partnerCommander &&
        (isExileProducer(partnerCommander) || hasExilePayoffIdentity(partnerCommander)));

    // Package-completion boost (bounded re-rank, cap +30): favors candidates
    // that complete a live engine's scarcer side — the positive counterpart to
    // the synergy-dependency gate. Investment is re-tallied per type pass so a
    // sac outlet picked in creatures raises the pull toward payoffs in spells.
    //
    // Also folds in the lift-pick boost (cap +30, see packageBoost.ts): the
    // validated EDHREC lift clusterScore, previously inert (exact-tie-only
    // tie-break — see liftTieBreak in cardPicking.ts). No-signal decks (empty
    // liftIndex, e.g. every golden fixture) get liftScoreOf(name) === 0 for
    // every candidate, so this is a no-op there.
    //
    // Also folds in the untap-visibility boost (cap +15, see packageBoost.ts):
    // gated on commanderWantsUntap above, so it's an empty map for every deck
    // whose commander doesn't care.
    //
    // Also folds in the blink and exile-matters visibility boosts (iter-8
    // Slice B, cap +15 each, see packageBoost.ts): same shape, each gated on
    // its own commanderWantsX above — empty maps for every deck whose
    // commander doesn't care about that theme.
    const withPackageBoosts = (
      boosts: Map<string, number>,
      pool: EDHRECCard[]
    ): Map<string, number> => {
      const picked = (Object.entries(categories) as [DeckCategory, ScryfallCard[]][])
        .filter(([cat]) => cat !== 'lands')
        .flatMap(([, cards]) => cards);
      const investment = tallyAxisInvestment(
        picked,
        [commander, partnerCommander].filter((c): c is ScryfallCard => !!c)
      );
      const pkg = computePackageBoosts(
        pool.map((c) => c.name),
        cardMap,
        investment
      );
      for (const [name, b] of pkg) boosts.set(name, (boosts.get(name) ?? 0) + b);
      const lift = computeLiftPickBoosts(
        pool.map((c) => c.name),
        liftScoreOf,
        2 * state.cfg.brewLevel
      );
      for (const [name, b] of lift) boosts.set(name, (boosts.get(name) ?? 0) + b);
      const untap = computeUntapVisibilityBoosts(
        pool.map((c) => c.name),
        cardMap,
        commanderWantsUntap,
        isUntapProducer
      );
      for (const [name, b] of untap) boosts.set(name, (boosts.get(name) ?? 0) + b);
      const blink = computeBlinkVisibilityBoosts(
        pool.map((c) => c.name),
        cardMap,
        commanderWantsBlink,
        isBlinkProducer
      );
      for (const [name, b] of blink) boosts.set(name, (boosts.get(name) ?? 0) + b);
      const exile = computeExileVisibilityBoosts(
        pool.map((c) => c.name),
        cardMap,
        commanderWantsExile,
        isExileProducer
      );
      for (const [name, b] of exile) boosts.set(name, (boosts.get(name) ?? 0) + b);
      return boosts;
    };

    // Now process each type synchronously using the pre-fetched cards
    // 1. Creatures
    logger.debug(
      `[DeckGen] Creatures: need ${creatureTarget}, pool has ${creaturePool.length} cards`
    );
    onProgress?.('Summoning creatures…', 35);
    const creatureBoosts = roleTargets
      ? computeRoleBoosts(
          cardRoleMap,
          roleTargets,
          currentRoleCounts,
          getComboBoosts(),
          cardCmcMap,
          cardSubtypeMap,
          currentSubtypeCounts,
          strictRoles
        )
      : getComboBoosts();
    const creatures = pickFromPrefetchedWithCurve(
      creaturePool,
      cardMap,
      creatureTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Creature',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      withPackageBoosts(creatureBoosts, creaturePool),
      currency,
      state.gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      bracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      roleTargets
        ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
        : undefined,
      priceSanity,
      getComboBoosts(),
      priceSanityDecided,
      state.cfg.brewLevel
    );
    categories.creatures.push(...creatures);
    for (const card of creatures) {
      const role = cardRoleMap.get(card.name);
      if (role) {
        currentRoleCounts[role]++;
        card.deckRole = role;
        stampRoleSubtypes(card);
        const st = cardSubtypeMap.get(card.name);
        if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
      }
    }
    logger.debug(`[DeckGen] Creatures: got ${creatures.length} from EDHREC`);

    // Fill remaining creatures from Scryfall if needed (use original target since categories include must-includes)
    if (categories.creatures.length < originalCreatureTarget) {
      const needed = originalCreatureTarget - categories.creatures.length;
      logger.debug(`[DeckGen] FALLBACK: Need ${needed} more creatures from Scryfall`);
      const moreCreatures = await fillWithScryfall(
        't:creature',
        colorIdentity,
        needed,
        usedNames,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        isCardAllowedBySynergyDependencies,
        liftScoreOf,
        fillGatesWithRoleCap()
      );
      categories.creatures.push(...moreCreatures);
      logger.debug(`[DeckGen] FALLBACK: Got ${moreCreatures.length} creatures from Scryfall`);
      for (const card of moreCreatures) {
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      }
    }

    // 2. Instants
    logger.debug(`[DeckGen] Instants: need ${instantTarget}, pool has ${instantPool.length} cards`);
    onProgress?.('Readying instants…', 45);
    const instantBoosts = roleTargets
      ? computeRoleBoosts(
          cardRoleMap,
          roleTargets,
          currentRoleCounts,
          getComboBoosts(),
          cardCmcMap,
          cardSubtypeMap,
          currentSubtypeCounts,
          strictRoles
        )
      : getComboBoosts();
    const instants = pickFromPrefetchedWithCurve(
      instantPool,
      cardMap,
      instantTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Instant',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      withPackageBoosts(instantBoosts, instantPool),
      currency,
      state.gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      bracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      roleTargets
        ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
        : undefined,
      priceSanity,
      getComboBoosts(),
      priceSanityDecided,
      state.cfg.brewLevel
    );
    logger.debug(`[DeckGen] Instants: got ${instants.length} from EDHREC`);
    categorizeCards(instants, categories);
    for (const card of instants) {
      const role = cardRoleMap.get(card.name);
      if (role) {
        currentRoleCounts[role]++;
        card.deckRole = role;
        stampRoleSubtypes(card);
        const st = cardSubtypeMap.get(card.name);
        if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
      }
    }

    // 3. Sorceries
    logger.debug(
      `[DeckGen] Sorceries: need ${sorceryTarget}, pool has ${sorceryPool.length} cards`
    );
    onProgress?.('Inscribing sorceries…', 55);
    const sorceryBoosts = roleTargets
      ? computeRoleBoosts(
          cardRoleMap,
          roleTargets,
          currentRoleCounts,
          getComboBoosts(),
          cardCmcMap,
          cardSubtypeMap,
          currentSubtypeCounts,
          strictRoles
        )
      : getComboBoosts();
    const sorceries = pickFromPrefetchedWithCurve(
      sorceryPool,
      cardMap,
      sorceryTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Sorcery',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      withPackageBoosts(sorceryBoosts, sorceryPool),
      currency,
      state.gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      bracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      roleTargets
        ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
        : undefined,
      priceSanity,
      getComboBoosts(),
      priceSanityDecided,
      state.cfg.brewLevel
    );
    logger.debug(`[DeckGen] Sorceries: got ${sorceries.length} from EDHREC`);
    categorizeCards(sorceries, categories);
    for (const card of sorceries) {
      const role = cardRoleMap.get(card.name);
      if (role) {
        currentRoleCounts[role]++;
        card.deckRole = role;
        stampRoleSubtypes(card);
        const st = cardSubtypeMap.get(card.name);
        if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
      }
    }

    // 4. Artifacts
    logger.debug(
      `[DeckGen] Artifacts: need ${artifactTarget}, pool has ${artifactPool.length} cards`
    );
    onProgress?.('Forging artifacts…', 62);
    const artifactBoosts = roleTargets
      ? computeRoleBoosts(
          cardRoleMap,
          roleTargets,
          currentRoleCounts,
          getComboBoosts(),
          cardCmcMap,
          cardSubtypeMap,
          currentSubtypeCounts,
          strictRoles
        )
      : getComboBoosts();
    const artifacts = pickFromPrefetchedWithCurve(
      artifactPool,
      cardMap,
      artifactTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Artifact',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      withPackageBoosts(artifactBoosts, artifactPool),
      currency,
      state.gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      bracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      roleTargets
        ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
        : undefined,
      priceSanity,
      getComboBoosts(),
      priceSanityDecided,
      state.cfg.brewLevel
    );
    logger.debug(`[DeckGen] Artifacts: got ${artifacts.length} from EDHREC`);
    categorizeCards(artifacts, categories);
    for (const card of artifacts) {
      const role = cardRoleMap.get(card.name);
      if (role) {
        currentRoleCounts[role]++;
        card.deckRole = role;
        stampRoleSubtypes(card);
        const st = cardSubtypeMap.get(card.name);
        if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
      }
    }

    // 5. Enchantments
    logger.debug(
      `[DeckGen] Enchantments: need ${enchantmentTarget}, pool has ${enchantmentPool.length} cards`
    );
    onProgress?.('Weaving enchantments…', 68);
    const enchantmentBoosts = roleTargets
      ? computeRoleBoosts(
          cardRoleMap,
          roleTargets,
          currentRoleCounts,
          getComboBoosts(),
          cardCmcMap,
          cardSubtypeMap,
          currentSubtypeCounts,
          strictRoles
        )
      : getComboBoosts();
    const enchantments = pickFromPrefetchedWithCurve(
      enchantmentPool,
      cardMap,
      enchantmentTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Enchantment',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      withPackageBoosts(enchantmentBoosts, enchantmentPool),
      currency,
      state.gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      bracketGuard,
      isCardAllowedBySynergyDependencies,
      liftTieBreak,
      roleTargets
        ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
        : undefined,
      priceSanity,
      getComboBoosts(),
      priceSanityDecided,
      state.cfg.brewLevel
    );
    logger.debug(`[DeckGen] Enchantments: got ${enchantments.length} from EDHREC`);
    categorizeCards(enchantments, categories);
    for (const card of enchantments) {
      const role = cardRoleMap.get(card.name);
      if (role) {
        currentRoleCounts[role]++;
        card.deckRole = role;
        stampRoleSubtypes(card);
        const st = cardSubtypeMap.get(card.name);
        if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
      }
    }

    // 6. Planeswalkers
    logger.debug(
      `[DeckGen] Planeswalkers: need ${planeswalkerTarget}, pool has ${planeswalkerPool.length} cards`
    );
    if (planeswalkerPool.length > 0 && planeswalkerTarget > 0) {
      onProgress?.('Calling planeswalkers…', 72);
      const planeswalkerBoosts = roleTargets
        ? computeRoleBoosts(
            cardRoleMap,
            roleTargets,
            currentRoleCounts,
            getComboBoosts(),
            cardCmcMap,
            cardSubtypeMap,
            currentSubtypeCounts,
            strictRoles
          )
        : getComboBoosts();
      const planeswalkers = pickFromPrefetchedWithCurve(
        planeswalkerPool,
        cardMap,
        planeswalkerTarget,
        usedNames,
        colorIdentity,
        curveTargets,
        currentCurveCounts,
        bannedCards,
        'Planeswalker',
        maxCardPrice,
        maxGameChangers,
        gameChangerCount,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        withPackageBoosts(planeswalkerBoosts, planeswalkerPool),
        currency,
        state.gameChangerNames,
        arenaOnly,
        strictCurve,
        collectionStrategy,
        collectionOwnedPercent,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        bracketGuard,
        isCardAllowedBySynergyDependencies,
        liftTieBreak,
        roleTargets
          ? { cardRoleMap, roleTargets, currentRoleCounts, overflowCounts: roleCapOverflowCounts }
          : undefined,
        priceSanity,
        getComboBoosts(),
        priceSanityDecided,
        state.cfg.brewLevel
      );
      logger.debug(`[DeckGen] Planeswalkers: got ${planeswalkers.length} from EDHREC`);
      categories.utility.push(...planeswalkers);
      for (const card of planeswalkers) {
        const role = cardRoleMap.get(card.name);
        if (role) {
          currentRoleCounts[role]++;
          card.deckRole = role;
          stampRoleSubtypes(card);
          const st = cardSubtypeMap.get(card.name);
          if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
        }
      }
    }

    // Log balanced roles result
    if (roleTargets) {
      logger.debug(
        `[DeckGen] Balanced Roles: final counts:`,
        { ...currentRoleCounts },
        'vs targets:',
        roleTargets
      );
    }

    // 7. Lands from EDHREC
    onProgress?.('Tapping the mana base…', 78);
    // Preserve must-include lands added earlier
    const mustIncludeLands = categories.lands.filter((c) => c.isMustInclude);
    const adjustedLandTarget = Math.max(0, targets.lands - mustIncludeLands.length);
    // Must-include lands are almost always non-basic — subtract them from the non-basic budget
    // so the remaining slots respect the user's basic/non-basic split
    const mustIncludeNonBasicCount = mustIncludeLands.filter(
      (c) => !getFrontFaceTypeLine(c).toLowerCase().includes('basic')
    ).length;
    const remainingNonBasicBudget = Math.max(
      0,
      customization.nonBasicLandCount - mustIncludeNonBasicCount
    );
    const nonbasicTarget = Math.min(remainingNonBasicBudget, adjustedLandTarget);
    const basicCount = Math.max(0, adjustedLandTarget - nonbasicTarget);

    logger.debug('[DeckGen] Land targets (from user preference):', {
      totalLandTarget: targets.lands,
      mustIncludeLands: mustIncludeLands.length,
      adjustedLandTarget,
      nonbasicTarget,
      basicTarget: basicCount,
      edhrecLandsAvailable: cardlists.lands.length,
    });

    if (cardlists.lands.length > 0) {
      logger.debug(
        '[DeckGen] Sample EDHREC lands:',
        cardlists.lands.slice(0, 3).map((l) => l.name)
      );
    }

    const allNonLandCards = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];

    categories.lands = [
      ...mustIncludeLands,
      ...(await generateLands(
        cardlists.lands,
        colorIdentity,
        adjustedLandTarget,
        usedNames,
        basicCount,
        format,
        allNonLandCards,
        onProgress,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        context.collectionAvailableCounts,
        currency,
        arenaOnly,
        scryfallQuery,
        preferredSet,
        collectionStrategy,
        collectionOwnedPercent,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        resolvedPacing,
        undefined,
        context.collectionBasicPrintings,
        fillGates
      )),
    ];

    // Log category counts after EDHREC selection
    logger.debug('[DeckGen] After EDHREC selection - Category counts:', {
      creatures: categories.creatures.length,
      ramp: categories.ramp.length,
      cardDraw: categories.cardDraw.length,
      singleRemoval: categories.singleRemoval.length,
      boardWipes: categories.boardWipes.length,
      synergy: categories.synergy.length,
      utility: categories.utility.length,
      lands: categories.lands.length,
    });

    // Collect swap candidates from leftover pool cards (role-based + type-based)
    swapCandidates = collectSwapCandidates(
      [creaturePool, instantPool, sorceryPool, artifactPool, enchantmentPool, planeswalkerPool],
      cardMap,
      usedNames,
      colorIdentity,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      context.collectionNames,
      currency,
      arenaOnly,
      collectionStrategy,
      15,
      ignoreOwnedRarity
    );
    logger.debug(
      `[DeckGen] Swap candidates: ${Object.entries(swapCandidates)
        .filter(([, v]) => v.length > 0)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(', ')}`
    );
  } else {
    // Fallback to Scryfall-based generation (no EDHREC data available)
    logger.warn(
      '[DeckGen] FALLBACK: No EDHREC data — using Scryfall-only generation with fallback type targets'
    );
    onProgress?.('Ramping up…', 20);
    categories.ramp = await fillWithScryfall(
      '(t:artifact o:"add" OR o:"search your library" o:land t:sorcery cmc<=3)',
      colorIdentity,
      targets.ramp,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );

    onProgress?.('Drawing cards…', 30);
    categories.cardDraw = await fillWithScryfall(
      'o:"draw" (t:instant OR t:sorcery OR t:enchantment)',
      colorIdentity,
      targets.cardDraw,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );

    onProgress?.('Sharpening removal…', 40);
    categories.singleRemoval = await fillWithScryfall(
      '(o:"destroy target" OR o:"exile target") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.singleRemoval,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );

    onProgress?.('Preparing board wipes…', 50);
    categories.boardWipes = await fillWithScryfall(
      '(o:"destroy all" OR o:"exile all") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.boardWipes,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );

    // Use typeTargets for remaining slots to get a balanced type distribution
    const scryfallCreatureTarget = Math.max(
      0,
      (typeTargets.creature ?? 0) -
        (preFilledTypeCounts.creature ?? 0) -
        categories.creatures.length
    );
    onProgress?.('Summoning creatures…', 60);
    const scryfallCreatures = await fillWithScryfall(
      't:creature',
      colorIdentity,
      scryfallCreatureTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );
    categories.creatures.push(...scryfallCreatures);

    const scryfallArtifactTarget = Math.max(
      0,
      (typeTargets.artifact ?? 0) - (preFilledTypeCounts.artifact ?? 0)
    );
    onProgress?.('Forging artifacts…', 65);
    const scryfallArtifacts = await fillWithScryfall(
      't:artifact -t:creature',
      colorIdentity,
      scryfallArtifactTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );
    categorizeCards(scryfallArtifacts, categories);

    const scryfallEnchantmentTarget = Math.max(
      0,
      (typeTargets.enchantment ?? 0) - (preFilledTypeCounts.enchantment ?? 0)
    );
    onProgress?.('Weaving enchantments…', 70);
    const scryfallEnchantments = await fillWithScryfall(
      't:enchantment -t:creature',
      colorIdentity,
      scryfallEnchantmentTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      isCardAllowedBySynergyDependencies,
      liftScoreOf,
      fillGates
    );
    categorizeCards(scryfallEnchantments, categories);

    const scryfallInstantTarget = Math.max(
      0,
      (typeTargets.instant ?? 0) -
        (preFilledTypeCounts.instant ?? 0) -
        categories.singleRemoval.length -
        categories.boardWipes.length
    );
    if (scryfallInstantTarget > 0) {
      onProgress?.('Readying instants…', 72);
      const scryfallInstants = await fillWithScryfall(
        't:instant',
        colorIdentity,
        scryfallInstantTarget,
        usedNames,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        isCardAllowedBySynergyDependencies,
        liftScoreOf,
        fillGates
      );
      categorizeCards(scryfallInstants, categories);
    }

    const scryfallSorceryTarget = Math.max(
      0,
      (typeTargets.sorcery ?? 0) - (preFilledTypeCounts.sorcery ?? 0)
    );
    if (scryfallSorceryTarget > 0) {
      onProgress?.('Inscribing sorceries…', 74);
      const scryfallSorceries = await fillWithScryfall(
        't:sorcery',
        colorIdentity,
        scryfallSorceryTarget,
        usedNames,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        isCardAllowedBySynergyDependencies,
        liftScoreOf,
        fillGates
      );
      categorizeCards(scryfallSorceries, categories);
    }

    onProgress?.('Tapping the mana base…', 80);
    // Preserve must-include lands added earlier
    const fallbackMustIncludeLands = categories.lands.filter((c) => c.isMustInclude);
    const fallbackAdjustedLandTarget = Math.max(0, targets.lands - fallbackMustIncludeLands.length);
    // Subtract must-include non-basics from the non-basic budget (same logic as EDHREC path)
    const fallbackMustIncludeNonBasicCount = fallbackMustIncludeLands.filter(
      (c) => !getFrontFaceTypeLine(c).toLowerCase().includes('basic')
    ).length;
    const fallbackRemainingNonBasicBudget = Math.max(
      0,
      customization.nonBasicLandCount - fallbackMustIncludeNonBasicCount
    );
    const fallbackNonbasicTarget = Math.min(
      fallbackRemainingNonBasicBudget,
      fallbackAdjustedLandTarget
    );
    const fallbackBasicCount = Math.max(0, fallbackAdjustedLandTarget - fallbackNonbasicTarget);
    const fallbackNonLandCards = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];
    categories.lands = [
      ...fallbackMustIncludeLands,
      ...(await generateLands(
        [],
        colorIdentity,
        fallbackAdjustedLandTarget,
        usedNames,
        fallbackBasicCount,
        format,
        fallbackNonLandCards,
        onProgress,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        context.collectionAvailableCounts,
        currency,
        arenaOnly,
        scryfallQuery,
        preferredSet,
        collectionStrategy,
        collectionOwnedPercent,
        ignoreOwnedBudget,
        ignoreOwnedRarity,
        resolvedPacing,
        undefined,
        context.collectionBasicPrintings,
        fillGates
      )),
    ];
  }

  // ── Auto-include staple mana rocks (like Command Tower for lands) ──
  await stapleManaRocksPhase(state, budgetTracker);

  // Calculate the target deck size (commander(s) are separate)
  // With partner, we need one fewer card since both commanders count toward the total
  const commanderCount = partnerCommander ? 2 : 1;
  const targetDeckSize = format === 99 ? 100 - commanderCount : format - commanderCount;

  // Helper to count all cards
  const countAllCards = () => stCountAllCards(state);

  // ── Superset-pick wildcard candidates (E82 attempt 6) ──
  // See phaseLandSqueezeReconcile.ts's header for the full mechanism. Pulls
  // every leftover EDHREC-pool card that already clears every pick-time gate
  // (the same pickFromPrefetchedWithCurve every type pass above uses), for
  // the reconcile below to re-rank by its own survival score and fold into
  // ONE combined cut alongside the existing incumbents. Gated on
  // wildcardCount so this is fully inert — empty array, zero scan cost — for
  // every non-auto-tuned generation and any auto-tuned deck that lands
  // exactly at the 32-land floor.
  const wildcardCount = landCountAutoTuned ? Math.max(0, resolvedLandCount - 32) : 0;
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
      context.collectionNames,
      getComboBoosts(),
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
      getComboBoosts()
    );
    // Hard role cap: same shape as isOverRoleCap's other two callers above
    // — a direct validateCardRole check against the real, current
    // currentRoleCounts, applied post-hoc instead of threading a
    // RoleCapConfig through the throwaway scan above.
    wildcardCandidates = rawWildcardCandidates.filter(
      (c) => !isOverRoleCap(c, roleTargets, currentRoleCounts)
    );
  }

  // ── Land-Squeeze Reconciliation (E88 + E82 attempt 6) ──
  // See phaseLandSqueezeReconcile.ts's header for the full mechanism. Runs
  // immediately before Smart Trim so the deck it hands off is already at (or
  // very near) targetDeckSize in the common case, making Smart Trim's own
  // `currentCount > targetDeckSize` check a no-op right after — zero changes
  // to Smart Trim itself. No-op when the auto-tune never raised land count
  // past baseline AND never produced any wildcard slots (squeezeDelta <= 0
  // && wildcardCount <= 0).
  const landSqueezeDelta = Math.max(0, resolvedLandCount - typeTargetLandCount);
  // Detected-COMPLETE combo pieces earn the same COMBO_TRIM_BOOST protection
  // as EDHREC-boosted combo attempts. `comboCardNames` above is only the
  // small top-N "attempted" combo list scored before any card was picked
  // (bounded by comboSliceCount/comboInclusionFloor, further gated on
  // edhrecData being present) — a combo can complete via unrelated picks
  // (staple inclusion, lift, a Game Changer already in the pool) and never
  // appear there, leaving it invisible to this reconcile's and Smart Trim's
  // COMBO_TRIM_BOOST check (both read `comboCardNames`/`state.comboCardNames`
  // directly). Preview detectCombosPhase against the current pre-reconcile
  // picks — pure, reads state only, no mutation — and fold any complete
  // combo's cards into the SAME set so every existing COMBO_TRIM_BOOST site
  // protects them too, with zero new plumbing.
  for (const dc of detectCombosPhase(state) ?? []) {
    if (dc.isComplete) for (const name of dc.cards) comboCardNames.add(name);
  }
  const landSqueezeResult = applyLandSqueezeReconcile(state, {
    liftScoreOf,
    roleTargets,
    currentRoleCounts,
    squeezeDelta: landSqueezeDelta,
    wildcardCandidates,
    wildcardCount,
    bracketGuard,
  });

  // ── Smart Trim: priority-aware, role-aware, combo-aware ──
  // Resistance formula lives in computeTrimResistance above (module-scope,
  // unit-tested independently of this orchestration).
  let currentCount = countAllCards();
  if (currentCount > targetDeckSize) {
    const trimCandidates: { card: ScryfallCard; category: DeckCategory; trimResistance: number }[] =
      [];

    // Protect lands: calculate how many non-must-include lands we can afford to trim
    const currentLandCount = categories.lands.length;
    const landTrimBudget = Math.max(0, currentLandCount - targets.lands);

    for (const cat of Object.keys(categories) as DeckCategory[]) {
      const cards = categories[cat];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const resistance = computeTrimResistance(
          card,
          i,
          cards.length,
          cat,
          comboCardNames,
          roleTargets,
          currentRoleCounts
        );
        trimCandidates.push({ card, category: cat, trimResistance: resistance });
      }
    }

    // Sort ascending: lowest resistance = first to trim
    trimCandidates.sort((a, b) => a.trimResistance - b.trimResistance);

    const excess = currentCount - targetDeckSize;
    // Respect the land trim budget: don't trim more lands than we can afford
    const toRemove: typeof trimCandidates = [];
    let landsTrimmed = 0;
    for (const candidate of trimCandidates) {
      if (toRemove.length >= excess) break;
      if (candidate.category === 'lands' && !candidate.card.isMustInclude) {
        if (landsTrimmed >= landTrimBudget) continue; // skip — would go below land target
        landsTrimmed++;
      }
      toRemove.push(candidate);
    }

    // Build removal sets per category for efficient filtering
    const removeByCategory = new Map<DeckCategory, Set<ScryfallCard>>();
    for (const { card, category } of toRemove) {
      if (!removeByCategory.has(category)) removeByCategory.set(category, new Set());
      removeByCategory.get(category)!.add(card);
    }

    // Apply removals
    for (const [cat, removeSet] of removeByCategory) {
      categories[cat] = categories[cat].filter((c) => !removeSet.has(c));
    }

    // Update role counts for trimmed role cards
    if (roleTargets) {
      for (const { card } of toRemove) {
        const role = validateCardRole(card);
        if (role && currentRoleCounts[role] > 0) {
          currentRoleCounts[role]--;
        }
      }
    }
  }

  // Track how many basic lands are added as filler when collection is too small
  let basicLandFillCount = 0;
  // Names of genuinely-unowned cards pulled in to complete an exhausted owned-only
  // pool (relaxation before basic padding). The surfaced count is derived from how
  // many of these SURVIVE the later combo audit / fixup passes (which can evict
  // them), so it never overstates what actually came from outside the collection.
  const relaxedNames = new Set<string>();
  let collectionRelaxedCount = 0;
  // "Wanted X → used your Y" rows for owned cards substituted in to complete an
  // owned-only deck (the smart relaxation below). Surfaced in the build report.
  const substitutionRows: SubstituteRow[] = [];

  // Add `amount` basic lands (Wastes for a colorless identity), split across
  // colors by weighted mana-pip demand of the deck's non-land cards so far.
  // Shared by the land-specific top-up right below and the total-count
  // last-resort fallback further down — same fill, two different reasons to
  // reach for it.
  const addBasicLands = async (amount: number): Promise<void> => {
    if (amount <= 0) return;
    const basicTypes: Record<string, string> = {
      W: 'Plains',
      U: 'Island',
      B: 'Swamp',
      R: 'Mountain',
      G: 'Forest',
    };
    const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

    if (colorsWithBasics.length > 0) {
      const allNonLands = [
        ...categories.creatures,
        ...categories.ramp,
        ...categories.cardDraw,
        ...categories.singleRemoval,
        ...categories.boardWipes,
        ...categories.utility,
        ...categories.synergy,
      ];
      const pipCounts = countColorPips(allNonLands);
      const totalPips = colorsWithBasics.reduce((sum, c) => sum + (pipCounts[c] || 0), 0);

      const landsPerColor: Record<string, number> = {};
      if (totalPips > 0) {
        let assigned = 0;
        for (let i = 0; i < colorsWithBasics.length; i++) {
          const color = colorsWithBasics[i];
          if (i === colorsWithBasics.length - 1) {
            landsPerColor[color] = amount - assigned;
          } else {
            landsPerColor[color] = Math.round((amount * (pipCounts[color] || 0)) / totalPips);
            assigned += landsPerColor[color];
          }
        }
      } else {
        const perColor = Math.floor(amount / colorsWithBasics.length);
        const remainder = amount % colorsWithBasics.length;
        for (let i = 0; i < colorsWithBasics.length; i++) {
          landsPerColor[colorsWithBasics[i]] = perColor + (i < remainder ? 1 : 0);
        }
      }

      for (const color of colorsWithBasics) {
        const basicName = basicTypes[color];
        const countForColor = landsPerColor[color];

        let basicCard = getCachedCard(basicName);
        if (!basicCard) {
          try {
            basicCard = await getCardByName(basicName, true);
          } catch {
            continue;
          }
        }

        // Top-up copies share card.id so the deck view aggregates them into
        // one row; allocation still claims any free owned copy by name.
        for (let j = 0; j < countForColor; j++) {
          categories.lands.push({ ...basicCard });
        }
      }
    } else {
      // Colorless deck — use Wastes as the basic land
      let wastesCard = getCachedCard('Wastes');
      if (!wastesCard) {
        try {
          wastesCard = await getCardByName('Wastes', true);
        } catch {
          // Skip if can't fetch
        }
      }
      if (wastesCard) {
        for (let j = 0; j < amount; j++) {
          categories.lands.push({ ...wastesCard });
        }
      }
    }
  };

  // Land top-up (Fix 1, iter-6 Slice B): gated on the land-specific deficit
  // (categories.lands.length vs targets.lands), not total card count — and
  // run BEFORE the generic nonland shortage fill below. generateLands() can
  // silently under-deliver (a basic-land fetch throws and that color's
  // allocation is dropped — landGenerator.ts's retry+reallocate hardening
  // makes this rare but not impossible); the old last-resort top-up was
  // gated on total count and ran AFTER the nonland fill, so a land shortfall
  // shipped as a full-size deck with a spell squatting in a land slot.
  const landDeficit = targets.lands - categories.lands.length;
  if (landDeficit > 0) {
    logger.debug(`[DeckGen] Land top-up: ${landDeficit} land(s) short of target, adding basics`);
    await addBasicLands(landDeficit);
  }

  // If we have too few cards, fill shortage — budget is best-effort here,
  // deck size and structure are non-negotiable
  currentCount = countAllCards();
  if (currentCount < targetDeckSize) {
    const shortage = targetDeckSize - currentCount;
    logger.debug(
      `[DeckGen] Deck shortage: need ${shortage} more cards (have ${currentCount}, need ${targetDeckSize})`
    );

    // For shortage fills: use a relaxed per-card cap derived from the budget
    // (5x the budget average) so we don't allow $84 cards in a $25 deck,
    // but still allow more flexibility than the strict budget tracker.
    // Falls back to the user's static maxCardPrice if no budget is set.
    const shortagePriceCap =
      deckBudget !== null
        ? Math.max(
            (deckBudget /
              Math.max(1, nonLandSlotsTotal + (customization.nonBasicLandCount ?? 15))) *
              5,
            maxCardPrice ?? 0
          )
        : maxCardPrice;
    if (budgetTracker) {
      logger.debug(
        `[DeckGen] Budget exhausted — filling remaining slots with relaxed cap: $${shortagePriceCap?.toFixed(2) ?? 'none'}`
      );
    }

    // Try to fill with remaining EDHREC cards (relaxed budget cap)
    // Respect type distribution targets when filling
    if (state.edhrecData && state.edhrecData.cardlists.allNonLand.length > 0) {
      const remainingEdhrecCards = state.edhrecData.cardlists.allNonLand
        .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
        .sort((a, b) => b.inclusion - a.inclusion);

      logger.debug(
        `[DeckGen] Found ${remainingEdhrecCards.length} remaining EDHREC cards to fill shortage`
      );

      const namesToFetch = remainingEdhrecCards.slice(0, shortage * 3).map((c) => c.name);
      const fillCardMap = await getCardsByNames(namesToFetch, undefined, preferredSet);
      if (preferredSet) {
        for (const [name, card] of fillCardMap) {
          if (card.set !== preferredSet) fillCardMap.delete(name);
        }
      }
      await upgradeCardPrintings(fillCardMap, scryfallQuery, true);

      // Calculate current type counts to prioritize types with the largest deficit
      const currentTypeCounts: Record<string, number> = {};
      for (const card of Object.values(categories).flat()) {
        const t = getSimpleCardType(getFrontFaceTypeLine(card).toLowerCase());
        if (t) currentTypeCounts[t] = (currentTypeCounts[t] ?? 0) + 1;
      }

      // Determine which types still need cards
      const typeNeed: Record<string, number> = {};
      for (const type of [
        'creature',
        'instant',
        'sorcery',
        'artifact',
        'enchantment',
        'planeswalker',
      ]) {
        typeNeed[type] = Math.max(0, (typeTargets[type] ?? 0) - (currentTypeCounts[type] ?? 0));
      }
      const totalTypeNeed = Object.values(typeNeed).reduce((s, v) => s + v, 0);

      // Role-cap gate for this backfill (E77 iter-4 round 2): this loop had no
      // role awareness at all — it could pad an already-surplus role forever
      // since it never even read currentRoleCounts. Same cap+escape-hatch
      // shape as the primary pick loop / Scryfall fallback (isOverRoleCap /
      // bumpRoleCapCount above), using validateCardRole directly (this loop
      // already has the full ScryfallCard in hand, no pre-built cardRoleMap
      // needed).
      const capSkippedNames = new Set<string>();
      const capSkipped: {
        edhrecCard: (typeof remainingEdhrecCards)[number];
        scryfallCard: ScryfallCard;
      }[] = [];

      let filled = 0;
      for (const edhrecCard of remainingEdhrecCards) {
        if (filled >= shortage) break;

        const scryfallCard = fillCardMap.get(edhrecCard.name);
        if (!scryfallCard) continue;

        if (!isCardAllowedBySynergyDependencies(scryfallCard)) continue;
        if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
        if (
          constrainsToCollection(collectionStrategy) &&
          notInCollection(edhrecCard.name, context.collectionNames)
        )
          continue;
        if (exceedsMaxPrice(scryfallCard, shortagePriceCap, currency)) continue;
        if (!isOwnedRarityExempt(edhrecCard.name, context.collectionNames, ignoreOwnedRarity)) {
          if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
        }
        if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

        // Prioritize cards that fill type deficits — bind type targets here too
        // (previously only did this when the user set explicit type
        // percentages, so a default-settings deck could silently pad this
        // shortage fill with whatever's popular regardless of type, skewing
        // spell density; e.g. Talrand ramp/instant balance). The second,
        // type-blind pass right below is still the disclosed escape hatch
        // when deficits can't be filled from what's left.
        if (totalTypeNeed > 0) {
          const cardType = getSimpleCardType(getFrontFaceTypeLine(scryfallCard).toLowerCase());
          // Skip cards of types the user set to 0 (or already at target)
          if (cardType && typeNeed[cardType] <= 0) continue;
          // Track the fill
          if (cardType && typeNeed[cardType] > 0) typeNeed[cardType]--;
        }

        if (isOverRoleCap(scryfallCard, roleTargets, currentRoleCounts)) {
          if (!capSkippedNames.has(edhrecCard.name)) {
            capSkippedNames.add(edhrecCard.name);
            capSkipped.push({ edhrecCard, scryfallCard });
          }
          continue;
        }

        routeCardByType(scryfallCard, categories);
        usedNames.add(edhrecCard.name);
        if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
        bumpRoleCapCount(
          scryfallCard,
          roleTargets,
          currentRoleCounts,
          roleCapOverflowCounts,
          false
        );
        filled++;
      }

      // If we still have shortage after type-respecting fill, do a second pass without type filter
      if (filled < shortage) {
        for (const edhrecCard of remainingEdhrecCards) {
          if (filled >= shortage) break;
          if (usedNames.has(edhrecCard.name)) continue;

          const scryfallCard = fillCardMap.get(edhrecCard.name);
          if (!scryfallCard) continue;

          if (!isCardAllowedBySynergyDependencies(scryfallCard)) continue;
          if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
          if (
            constrainsToCollection(collectionStrategy) &&
            notInCollection(edhrecCard.name, context.collectionNames)
          )
            continue;
          if (exceedsMaxPrice(scryfallCard, shortagePriceCap, currency)) continue;
          if (!isOwnedRarityExempt(edhrecCard.name, context.collectionNames, ignoreOwnedRarity)) {
            if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
          }
          if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

          if (isOverRoleCap(scryfallCard, roleTargets, currentRoleCounts)) {
            if (!capSkippedNames.has(edhrecCard.name)) {
              capSkippedNames.add(edhrecCard.name);
              capSkipped.push({ edhrecCard, scryfallCard });
            }
            continue;
          }

          routeCardByType(scryfallCard, categories);
          usedNames.add(edhrecCard.name);
          if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
          bumpRoleCapCount(
            scryfallCard,
            roleTargets,
            currentRoleCounts,
            roleCapOverflowCounts,
            false
          );
          filled++;
        }
      }

      // Escape hatch: never ship short over a soft role target — admit the
      // least-over-target cap-skipped candidates (every other gate above
      // already applied when they were first considered).
      if (filled < shortage && capSkipped.length > 0) {
        capSkipped.sort(
          (a, b) =>
            roleCapOverage(a.scryfallCard, roleTargets, currentRoleCounts) -
            roleCapOverage(b.scryfallCard, roleTargets, currentRoleCounts)
        );
        let admitted = 0;
        for (const { edhrecCard, scryfallCard } of capSkipped) {
          if (filled >= shortage) break;
          if (admitted >= ROLE_CAP_HATCH_MAX_PER_PASS) break;
          if (usedNames.has(edhrecCard.name)) continue;
          routeCardByType(scryfallCard, categories);
          usedNames.add(edhrecCard.name);
          if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
          bumpRoleCapCount(
            scryfallCard,
            roleTargets,
            currentRoleCounts,
            roleCapOverflowCounts,
            true
          );
          filled++;
          admitted++;
        }
      }

      logger.debug(`[DeckGen] Filled ${filled} cards from remaining EDHREC suggestions`);
    }

    // If still short after EDHREC, use Scryfall — fill by type to stay balanced
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const stillNeeded = targetDeckSize - currentCount;
      logger.debug(`[DeckGen] Still need ${stillNeeded} more cards, using Scryfall fallback`);

      // Calculate current type counts to figure out which types are most under-target
      const currentTypeCounts: Record<string, number> = {};
      for (const card of Object.values(categories).flat()) {
        const tl = getFrontFaceTypeLine(card).toLowerCase();
        if (tl.includes('land')) continue;
        const t = tl.includes('creature')
          ? 'creature'
          : tl.includes('instant')
            ? 'instant'
            : tl.includes('sorcery')
              ? 'sorcery'
              : tl.includes('artifact')
                ? 'artifact'
                : tl.includes('enchantment')
                  ? 'enchantment'
                  : null;
        if (t) currentTypeCounts[t] = (currentTypeCounts[t] ?? 0) + 1;
      }

      // Build a list of (type, deficit) sorted by largest deficit first
      const typeDeficits: { type: string; query: string; deficit: number }[] = [
        {
          type: 'creature',
          query: 't:creature',
          deficit: (typeTargets.creature ?? 0) - (currentTypeCounts.creature ?? 0),
        },
        {
          type: 'instant',
          query: 't:instant',
          deficit: (typeTargets.instant ?? 0) - (currentTypeCounts.instant ?? 0),
        },
        {
          type: 'sorcery',
          query: 't:sorcery',
          deficit: (typeTargets.sorcery ?? 0) - (currentTypeCounts.sorcery ?? 0),
        },
        {
          type: 'artifact',
          query: 't:artifact -t:creature',
          deficit: (typeTargets.artifact ?? 0) - (currentTypeCounts.artifact ?? 0),
        },
        {
          type: 'enchantment',
          query: 't:enchantment -t:creature',
          deficit: (typeTargets.enchantment ?? 0) - (currentTypeCounts.enchantment ?? 0),
        },
      ]
        .filter((d) => d.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);

      logger.debug(
        '[DeckGen] Shortfall type deficits:',
        typeDeficits.map((d) => `${d.type}: ${d.deficit}`).join(', ') || 'none'
      );

      let filled = 0;
      for (const { type, query, deficit } of typeDeficits) {
        if (filled >= stillNeeded) break;
        const toFill = Math.min(deficit, stillNeeded - filled);
        const cards = await fillWithScryfall(
          query,
          colorIdentity,
          toFill,
          usedNames,
          bannedCards,
          shortagePriceCap,
          maxRarity,
          maxCmc,
          null,
          context.collectionNames,
          currency,
          arenaOnly,
          scryfallQuery,
          collectionStrategy,
          ignoreOwnedBudget,
          ignoreOwnedRarity,
          isCardAllowedBySynergyDependencies,
          liftScoreOf,
          fillGatesWithRoleCap()
        );
        if (type === 'creature') categories.creatures.push(...cards);
        else if (type === 'instant') categorizeCards(cards, categories);
        else if (type === 'sorcery') categorizeCards(cards, categories);
        else if (type === 'artifact') categorizeCards(cards, categories);
        else if (type === 'enchantment') categorizeCards(cards, categories);
        filled += cards.length;
      }

      // If still short after typed fills, use generic query as absolute last resort
      if (filled < stillNeeded) {
        const remaining = stillNeeded - filled;
        logger.warn(
          `[DeckGen] FALLBACK: Typed shortfall fills not enough (got ${filled}/${stillNeeded}), using generic query for ${remaining} remaining`
        );
        const moreCards = await fillWithScryfall(
          '(t:artifact OR t:enchantment OR t:creature)',
          colorIdentity,
          remaining,
          usedNames,
          bannedCards,
          shortagePriceCap,
          maxRarity,
          maxCmc,
          null,
          context.collectionNames,
          currency,
          arenaOnly,
          scryfallQuery,
          collectionStrategy,
          ignoreOwnedBudget,
          ignoreOwnedRarity,
          isCardAllowedBySynergyDependencies,
          liftScoreOf,
          fillGatesWithRoleCap()
        );
        categorizeCards(moreCards, categories);
        filled += moreCards.length;
      }

      logger.debug(`[DeckGen] Filled ${filled} cards from Scryfall shortfall`);
    }

    // Relax an exhausted owned-only pool. In owned-only modes ('full'/'available')
    // the steps above gate every pick to owned cards, so a too-small owned pool
    // would otherwise pad the rest with basic lands. Instead, fill the gap from
    // the collection FIRST — only reaching outside it as a flagged last resort.
    // Three tiers, each running only if the deck is still short:
    //   1. Substitute the CLOSEST owned card for the most-wanted unowned EDHREC
    //      staples (similarity-ranked: tags + type + subtype + CMC), recorded as
    //      "Wanted X → used your Y" provenance.
    //   2. Generic owned backfill — the best owned in-color cards (still hard-
    //      gated to owned by passing the real strategy, not 'prefer').
    //   3. Outside the collection — surfaced loudly in the build report.
    currentCount = countAllCards();
    if (currentCount < targetDeckSize && constrainsToCollection(collectionStrategy)) {
      // Add a fetched card to the right category + role count (mirrors fixupAddCard).
      // Callers dedupe before calling (Tier 1 pre-checks usedNames; fillWithScryfall
      // already skips used names), so no guard here — and fillWithScryfall pre-adds
      // its results to usedNames, so a guard here would wrongly drop every Tier 2/3
      // card and leave the deck padded with basics instead.
      //
      // Role-cap gate (E77 iter-4 round 2): this helper used to add every card
      // unconditionally — a role-capped card could keep landing here and the
      // deck would fall through to BASIC-LAND padding instead (worse than an
      // over-cap spell). Returns false and stashes the card for the shared
      // escape hatch below rather than silently over-filling the role.
      const ownedCapSkipped: ScryfallCard[] = [];
      const addOwnedCard = (card: ScryfallCard, allowCapOverflow = false): boolean => {
        if (!allowCapOverflow && isOverRoleCap(card, roleTargets, currentRoleCounts)) {
          ownedCapSkipped.push(card);
          return false;
        }
        stampRoleSubtypes(card);
        routeCardByType(card, categories);
        usedNames.add(card.name);
        bumpRoleCapCount(
          card,
          roleTargets,
          currentRoleCounts,
          roleCapOverflowCounts,
          allowCapOverflow
        );
        return true;
      };

      // ── Tier 1: closest owned substitutes for the most-wanted unowned staples ──
      const ownedPool = context.collectionPool ?? [];
      if (ownedPool.length > 0 && state.edhrecData) {
        const need = targetDeckSize - currentCount;
        const inclusionByName = new Map<string, number>();
        const missingStaples: GapAnalysisCard[] = [];
        for (const edhrecCard of state.edhrecData.cardlists.allNonLand) {
          inclusionByName.set(edhrecCard.name, edhrecCard.inclusion);
          if (usedNames.has(edhrecCard.name) || bannedCards.has(edhrecCard.name)) continue;
          if (!notInCollection(edhrecCard.name, context.collectionNames)) continue; // want UNOWNED staples
          const role = getCardRole(edhrecCard.name);
          if (!role) continue; // only role-classified staples have owned substitutes
          const sc = scryfallCardMap.get(edhrecCard.name);
          missingStaples.push({
            name: edhrecCard.name,
            price: null,
            inclusion: edhrecCard.inclusion,
            synergy: edhrecCard.synergy ?? 0,
            typeLine: sc ? getFrontFaceTypeLine(sc) : (edhrecCard.primary_type ?? ''),
            cmc: sc?.cmc ?? edhrecCard.cmc,
            role,
          });
        }
        // Most-wanted first; cap the search to keep the similarity pass bounded —
        // 4× the deficit leaves headroom for staples with no owned match.
        missingStaples.sort((a, b) => b.inclusion - a.inclusion);
        const candidates = missingStaples.slice(0, Math.max(need * 4, 40));

        const deckNames = new Set(
          Object.values(categories)
            .flat()
            .map((c) => c.name)
        );
        const plan = buildSubstitutionPlan(candidates, ownedPool, deckNames, colorIdentity, {
          inclusionByName,
        });
        const chosen = plan.rows.slice(0, need);
        if (chosen.length > 0) {
          const fetched = await getCardsByNames(chosen.map((r) => r.usedName));
          for (const row of chosen) {
            const card = fetched.get(row.usedName);
            if (!card || usedNames.has(card.name)) continue;
            if (!isCardAllowedBySynergyDependencies(card)) continue;
            // ponytail: a role-capped substitute defers to the escape hatch
            // below rather than recording provenance here — it still gets
            // added to the deck, just without a "Wanted X → used your Y" row.
            if (addOwnedCard(card)) substitutionRows.push(row);
          }
          logger.debug(
            `[DeckGen] Substituted ${substitutionRows.length} owned card(s) for staples`
          );
        }
      }

      // ── Tier 2: generic owned backfill (best owned in-color cards) ──
      currentCount = countAllCards();
      if (currentCount < targetDeckSize) {
        const ownedFill = await fillWithScryfall(
          '(t:creature OR t:instant OR t:sorcery OR t:artifact OR t:enchantment)',
          colorIdentity,
          targetDeckSize - currentCount,
          usedNames,
          bannedCards,
          shortagePriceCap,
          maxRarity,
          maxCmc,
          null,
          context.collectionNames,
          currency,
          arenaOnly,
          scryfallQuery,
          collectionStrategy, // real strategy → HARD-gates to owned cards
          ignoreOwnedBudget,
          ignoreOwnedRarity,
          isCardAllowedBySynergyDependencies,
          liftScoreOf,
          fillGates
        );
        for (const c of ownedFill) addOwnedCard(c);
        if (ownedFill.length > 0) {
          logger.debug(
            `[DeckGen] Backfilled ${ownedFill.length} owned card(s) from the collection`
          );
        }
      }

      // ── Tier 3: reach outside the collection (flagged) only if still short ──
      currentCount = countAllCards();
      if (currentCount < targetDeckSize) {
        const relaxedCards = await fillWithScryfall(
          '(t:creature OR t:instant OR t:sorcery OR t:artifact OR t:enchantment)',
          colorIdentity,
          targetDeckSize - currentCount,
          usedNames,
          bannedCards,
          shortagePriceCap,
          maxRarity,
          maxCmc,
          null,
          context.collectionNames,
          currency,
          arenaOnly,
          scryfallQuery,
          'prefer', // drops the hard owned gate — last resort
          ignoreOwnedBudget,
          ignoreOwnedRarity,
          isCardAllowedBySynergyDependencies,
          liftScoreOf,
          fillGates
        );
        for (const c of relaxedCards) {
          if (addOwnedCard(c) && notInCollection(c.name, context.collectionNames)) {
            relaxedNames.add(c.name);
          }
        }
        if (relaxedCards.length > 0) {
          logger.debug(
            `[DeckGen] Collection exhausted — relaxed to ${relaxedCards.length} cards from outside it`
          );
        }
      }

      // Escape hatch: never let a role cap alone push the deck to BASIC-LAND
      // padding when a real (if over-cap) spell was already fetched — admit
      // the least-over-target cap-skipped candidates from any of the 3 tiers
      // above, still gated by everything each tier already checked before
      // deferring them here.
      currentCount = countAllCards();
      if (currentCount < targetDeckSize && ownedCapSkipped.length > 0) {
        ownedCapSkipped.sort(
          (a, b) =>
            roleCapOverage(a, roleTargets, currentRoleCounts) -
            roleCapOverage(b, roleTargets, currentRoleCounts)
        );
        let admitted = 0;
        for (const card of ownedCapSkipped) {
          if (countAllCards() >= targetDeckSize) break;
          if (admitted >= ROLE_CAP_HATCH_MAX_PER_PASS) break;
          if (usedNames.has(card.name)) continue;
          if (addOwnedCard(card, true)) {
            if (notInCollection(card.name, context.collectionNames)) relaxedNames.add(card.name);
            admitted++;
          }
        }
      }
    }

    // If STILL short, add basic lands as absolute last resort
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const remainingShortage = targetDeckSize - currentCount;
      basicLandFillCount = remainingShortage;
      logger.debug(`[DeckGen] Still need ${remainingShortage} more cards, adding basic lands`);
      await addBasicLands(remainingShortage);
    }
  }

  // Final verification - log warning if still wrong
  const finalCount = countAllCards();
  if (finalCount !== targetDeckSize) {
    logger.warn(
      `[DeckGen] Final deck size mismatch: got ${finalCount}, expected ${targetDeckSize}`
    );
  }

  // Log budget tracker summary
  if (budgetTracker) {
    const allDeckCards = Object.values(categories).flat();
    const totalSpent = allDeckCards.reduce((sum, c) => {
      const p = getCardPrice(c, currency);
      return sum + (p ? parseFloat(p) || 0 : 0);
    }, 0);
    const sym = currency === 'EUR' ? '€' : '$';
    logger.debug(
      `[BudgetTracker] Final: deck cards ${sym}${totalSpent.toFixed(2)} (budget: ${sym}${deckBudget}, excludes commander cost)`
    );
    logger.debug(
      `[BudgetTracker] Remaining: $${budgetTracker.remainingBudget.toFixed(2)}, cards left: ${budgetTracker.cardsRemaining}`
    );
  }

  // Get the theme names that were actually used
  const usedThemes =
    selectedThemesWithSlugs.length > 0 ? selectedThemesWithSlugs.map((t) => t.name) : undefined;

  // Gap analysis: find top unowned cards that would improve the deck
  const gapAnalysis = await gapAnalysisPhase(state, { effectiveScryfallQuery: scryfallQuery });

  // Snapshot pre-swap deck membership: the combo audit / fixup / coherence
  // repair / bracket convergence passes below can still cut cards, and a card
  // they cut shouldn't immediately resurface as a "hidden synergy" package
  // pick (e.g. Yuriko-bracket4 re-suggesting the Kaito Shizuki this very pass
  // just cut). Diffed against the post-swap usedNames right before lift picks
  // run, further down — after every mutating phase, not before them.
  const preSwapUsedNames = new Set(usedNames);

  // Detect combos present in the generated deck
  let detectedCombos = detectCombosPhase(state);

  // Swaps the Combo Integrity Audit below applies — merged into
  // coherenceRepairs further down (T37 ethos: nothing moves silently, every
  // auto-fix is disclosed). Was previously logger.debug-only.
  const comboAuditRepairs: CoherenceRepair[] = [];

  // ── Combo Integrity Audit ──
  // After deck assembly: if a combo piece slipped in but its combo is incomplete,
  // either complete the combo (swap in missing pieces) or evict the low-value orphan.
  if (detectedCombos && state.edhrecData && comboCountSetting > 0) {
    const ORPHAN_INCLUSION_THRESHOLD = 25; // below this %, the card is considered combo-dependent
    const MAX_AUDIT_SWAPS = 4;
    let auditSwaps = 0;

    // Build inclusion index from EDHREC pool
    const auditInclusion = new Map<string, number>();
    for (const c of state.edhrecData.cardlists.allNonLand) auditInclusion.set(c.name, c.inclusion);

    // Build must-include protection set
    const auditMustInclude = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);

    // Track cards that are part of a COMPLETE combo — never evict them
    const completeComboCards = new Set<string>();
    for (const dc of detectedCombos) {
      if (dc.isComplete) for (const name of dc.cards) completeComboCards.add(name);
    }

    // Count how many detected combos (complete or near-miss) each card appears in.
    // Cards in 2+ combos are valuable enablers and should not be treated as orphans.
    const cardComboCount = new Map<string, number>();
    for (const dc of detectedCombos) {
      for (const name of dc.cards) {
        if (usedNames.has(name)) cardComboCount.set(name, (cardComboCount.get(name) ?? 0) + 1);
      }
    }

    // Helper: find the weakest (lowest inclusion%) evictable non-land card
    function auditWeakest(
      skipNames?: Set<string>
    ): { card: ScryfallCard; category: DeckCategory } | null {
      let best: { card: ScryfallCard; category: DeckCategory; incl: number } | null = null;
      for (const cat of Object.keys(categories) as DeckCategory[]) {
        if (cat === 'lands') continue;
        for (const card of categories[cat]) {
          if (auditMustInclude.has(card.name.toLowerCase())) continue;
          if (completeComboCards.has(card.name)) continue;
          if (isProtectionPiece(card) || isFreeInteraction(card)) continue;
          if (skipNames?.has(card.name)) continue;
          const incl = auditInclusion.get(card.name) ?? 0;
          if (!best || incl < best.incl) best = { card, category: cat, incl };
        }
      }
      return best ? { card: best.card, category: best.category } : null;
    }

    function auditRemove(card: ScryfallCard, category: DeckCategory) {
      categories[category] = categories[category].filter((c) => c !== card);
      usedNames.delete(card.name);
      // E87: this cut is about to be disclosed in coherenceRepairs — veto the
      // name so no downstream add phase (bracket/budget convergence, role-
      // surplus rebalance, lift picks) can silently re-pick it and leave the
      // disclosure describing an intermediate state the shipped deck contradicts.
      markBanned(card.name);
    }

    // Same budget gate cardPicking/scryfallFill/coherenceRepair enforce — owned
    // copies are exempt, everything else checks the live effective cap.
    function auditPassesBudget(card: ScryfallCard): boolean {
      if (isOwnedBudgetExempt(card.name, context.collectionNames, ignoreOwnedBudget)) return true;
      const cap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      return !exceedsMaxPrice(card, cap, currency);
    }

    function auditAdd(card: ScryfallCard): boolean {
      if (usedNames.has(card.name)) return false; // guard against duplicates
      if (bannedCards.has(card.name)) return false; // respect banlist
      // Defense-in-depth: every call site below pre-filters candidates for
      // color identity before evicting a card to make room (a candidate
      // fetch batch pulls in EVERY combo's cards, on- or off-color, purely
      // to resolve near-miss detection — see the batch fetch above — so this
      // is the only gate standing between an off-identity combo card and the
      // decklist). Sites must still pre-filter so a rejected add doesn't
      // strand the just-evicted card with nothing added back.
      if (!fitsColorIdentity(card, colorIdentity)) return false;
      stampRoleSubtypes(card);
      routeCardByType(card, categories);
      usedNames.add(card.name);
      if (!isOwnedBudgetExempt(card.name, context.collectionNames, ignoreOwnedBudget)) {
        budgetTracker?.deductCard(card);
      }
      return true;
    }

    // ── Phase 1: Multi-combo enablers ──
    // Before processing individual combos, find single cards NOT in the deck that
    // would complete the most near-miss combos. One Gravecrawler completing 5 combos
    // is far more valuable than 2 cards completing 1 isolated combo.
    {
      // For each missing card across all near-miss combos, count how many combos
      // it would complete if added (i.e., it's the ONLY missing piece for that combo).
      const enablerScore = new Map<string, number>(); // cardName → combos it would complete
      const enablerCombos = new Map<string, string[]>(); // cardName → combo IDs

      for (const dc of detectedCombos) {
        if (dc.isComplete) continue;
        const trulyMissing = dc.missingCards.filter((n) => !usedNames.has(n));
        // Only count combos where this card is the sole missing piece
        if (trulyMissing.length !== 1) continue;
        const name = trulyMissing[0];
        if (bannedCards.has(name) || !scryfallCardMap.has(name)) continue;
        if (
          constrainsToCollection(collectionStrategy) &&
          notInCollection(name, context.collectionNames)
        )
          continue;
        // The batch fetch above resolves every combo's cards regardless of
        // color identity (needed to detect near-misses at all) — this is
        // the only gate keeping an off-identity combo card out of the deck.
        if (!fitsColorIdentity(scryfallCardMap.get(name)!, colorIdentity)) continue;
        enablerScore.set(name, (enablerScore.get(name) ?? 0) + 1);
        const ids = enablerCombos.get(name) ?? [];
        ids.push(dc.comboId);
        enablerCombos.set(name, ids);
      }

      // Sort by combos completed (descending), only consider cards completing 2+ combos
      const topEnablers = [...enablerScore.entries()]
        .filter(([, count]) => count >= 2)
        .sort(([, a], [, b]) => b - a);

      for (const [name, combosCompleted] of topEnablers) {
        if (auditSwaps >= MAX_AUDIT_SWAPS) break;
        const card = scryfallCardMap.get(name)!;
        if (!auditPassesBudget(card)) {
          comboBudgetSkipCount++;
          continue; // next-best enabler under budget
        }
        const weak = auditWeakest();
        if (!weak) break;
        auditRemove(weak.card, weak.category);
        if (auditAdd(card)) {
          auditSwaps++;
          comboAuditRepairs.push({
            cut: weak.card.name,
            added: card.name,
            reason: `${weak.card.name} (${auditInclusion.get(weak.card.name) ?? 0}% inclusion) wasn't earning its slot — swapped for ${card.name}, which completes ${combosCompleted} near-miss combo${combosCompleted === 1 ? '' : 's'}.`,
          });
          // Mark all combos this card completes
          for (const dc of detectedCombos) {
            if (dc.isComplete) continue;
            const stillMissing = dc.missingCards.filter((n) => !usedNames.has(n));
            if (stillMissing.length === 0) {
              dc.isComplete = true;
              dc.missingCards = [];
            }
          }
          // Update completeComboCards so newly completed combo pieces are protected
          for (const dc of detectedCombos) {
            if (dc.isComplete) for (const n of dc.cards) completeComboCards.add(n);
          }
          logger.debug(
            `[DeckGen] Combo audit: added multi-combo enabler ${name} (completes ${combosCompleted} combos) → evicted ${weak.card.name} (${auditInclusion.get(weak.card.name) ?? 0}%)`
          );
        }
      }
    }

    // ── Phase 2: Per-combo completion / orphan eviction (existing logic) ──
    for (const dc of detectedCombos) {
      if (dc.isComplete || auditSwaps >= MAX_AUDIT_SWAPS) continue;

      // Find in-deck pieces that only justify their slot because of this combo.
      // Cards in 2+ combos are valuable enablers — never treat them as orphans.
      const orphans = dc.cards.filter((name) => {
        if (!usedNames.has(name)) return false;
        if (auditMustInclude.has(name.toLowerCase())) return false;
        if (completeComboCards.has(name)) return false;
        if ((cardComboCount.get(name) ?? 0) >= 2) return false;
        return (auditInclusion.get(name) ?? 0) <= ORPHAN_INCLUSION_THRESHOLD;
      });

      if (orphans.length === 0) continue; // all in-deck pieces are fine standalone

      // Check if we can complete the combo: missing pieces must be available, not banned, and not already in deck
      const trulyMissing = dc.missingCards.filter((n) => !usedNames.has(n));
      const missingResolved = trulyMissing
        .filter((n) => !bannedCards.has(n))
        .filter(
          (n) =>
            !(
              constrainsToCollection(collectionStrategy) &&
              notInCollection(n, context.collectionNames)
            )
        )
        .map((n) => scryfallCardMap.get(n))
        .filter((c): c is ScryfallCard => !!c)
        // The batch fetch above resolves every combo's cards regardless of
        // color identity (needed to detect near-misses at all) — this is
        // the only gate keeping an off-identity combo card out of the deck.
        .filter((c) => fitsColorIdentity(c, colorIdentity))
        .filter((c) => {
          if (auditPassesBudget(c)) return true;
          comboBudgetSkipCount++;
          return false;
        });

      // If all "missing" pieces are actually already in the deck now, mark complete and move on
      if (trulyMissing.length === 0) {
        dc.isComplete = true;
        dc.missingCards = [];
        continue;
      }

      const canComplete =
        missingResolved.length === trulyMissing.length &&
        auditSwaps + trulyMissing.length <= MAX_AUDIT_SWAPS;

      if (canComplete) {
        // Swap in the missing pieces by evicting the weakest non-essential cards
        const evicted = new Set<string>();
        let ok = true;
        for (const missing of missingResolved) {
          if (usedNames.has(missing.name)) continue; // already in deck from a prior combo
          const weak = auditWeakest(evicted);
          if (!weak) {
            ok = false;
            break;
          }
          evicted.add(weak.card.name);
          auditRemove(weak.card, weak.category);
          if (!auditAdd(missing)) {
            ok = false;
            break;
          }
          auditSwaps++;
          comboAuditRepairs.push({
            cut: weak.card.name,
            added: missing.name,
            reason: `Completes the ${dc.cards.join(' + ')} combo${dc.results[0] ? ` (${dc.results[0]})` : ''} — swapped in ${missing.name}.`,
          });
        }
        if (ok) {
          logger.debug(
            `[DeckGen] Combo audit: completed combo ${dc.comboId} → added ${missingResolved.map((c) => c.name).join(', ')}`
          );
          dc.isComplete = true;
          dc.missingCards = [];
        }
      } else {
        // Can't complete — evict the orphaned low-value pieces, replace with best EDHREC candidates
        for (const orphanName of orphans) {
          if (auditSwaps >= MAX_AUDIT_SWAPS) break;
          // Never evict lands here — the replacement pool below is
          // allNonLand-only, so an orphaned combo piece that happens to be a
          // land (e.g. Riptide Laboratory) would get silently swapped for a
          // spell, shrinking the land count out from under the resolved
          // target. Lands have their own top-up/target and stay untouched by
          // this audit, same as auditWeakest/findWeakestCard just above.
          let found: { card: ScryfallCard; category: DeckCategory } | null = null;
          for (const cat of Object.keys(categories) as DeckCategory[]) {
            if (cat === 'lands') continue;
            const card = categories[cat].find((c) => c.name === orphanName);
            if (card) {
              found = { card, category: cat };
              break;
            }
          }
          if (!found) continue;
          const replacementCandidates = state.edhrecData.cardlists.allNonLand
            .filter(
              (c) =>
                !usedNames.has(c.name) &&
                !bannedCards.has(c.name) &&
                scryfallCardMap.has(c.name) &&
                fitsColorIdentity(scryfallCardMap.get(c.name)!, colorIdentity) &&
                !(
                  constrainsToCollection(collectionStrategy) &&
                  notInCollection(c.name, context.collectionNames)
                )
            )
            .sort((a, b) => b.inclusion - a.inclusion);
          // Fall through past budget-exceeding candidates to the next-best one.
          let replacement: (typeof replacementCandidates)[0] | undefined;
          for (const cand of replacementCandidates) {
            if (auditPassesBudget(scryfallCardMap.get(cand.name)!)) {
              replacement = cand;
              break;
            }
            comboBudgetSkipCount++;
          }
          if (!replacement) continue;
          auditRemove(found.card, found.category);
          // Gate on the result — an EDHREC-pool candidate should always be
          // legal/unbanned/undupe by construction, but auditAdd is the sole
          // backstop; an unchecked call here previously left the orphan
          // evicted with nothing added back if it ever returned false.
          if (auditAdd(scryfallCardMap.get(replacement.name)!)) {
            auditSwaps++;
            comboAuditRepairs.push({
              cut: orphanName,
              added: replacement.name,
              reason: `${orphanName} was an orphaned piece of an incomplete combo (still missing ${trulyMissing.length} card${trulyMissing.length === 1 ? '' : 's'}) — swapped for ${replacement.name}.`,
            });
            logger.debug(
              `[DeckGen] Combo audit: evicted orphan ${orphanName} (${auditInclusion.get(orphanName) ?? 0}% inclusion) → ${replacement.name}`
            );
          }
        }
      }
    }

    // Rebuild detectedCombos if deck changed so completeness flags are accurate
    if (auditSwaps > 0) {
      const newDeckNames = new Set<string>();
      if (commander) {
        newDeckNames.add(commander.name);
        if (commander.name.includes(' // ')) newDeckNames.add(frontFaceName(commander.name));
      }
      if (partnerCommander) {
        newDeckNames.add(partnerCommander.name);
        if (partnerCommander.name.includes(' // '))
          newDeckNames.add(frontFaceName(partnerCommander.name));
      }
      for (const c of Object.values(categories).flat()) {
        newDeckNames.add(c.name);
        if (c.name.includes(' // ')) newDeckNames.add(frontFaceName(c.name));
      }
      detectedCombos = detectedCombos
        .map((dc) => {
          const missing = dc.cards.filter((n) => !newDeckNames.has(n));
          return { ...dc, isComplete: missing.length === 0, missingCards: missing };
        })
        .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
      if (detectedCombos.length === 0) detectedCombos = undefined;
      logger.debug(`[DeckGen] Combo audit complete: ${auditSwaps} swap(s) applied`);
    }
  }

  // ── Combo Floor ──
  // If the deck has zero complete 2-card combos and bracket allows it,
  // seed the single best available 2-card combo (1-card-missing).
  {
    const mustIncludeSet = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);
    const floorResult = applyComboFloor(state, {
      detectedCombos,
      scryfallCardMap,
      mustIncludeNames: mustIncludeSet,
      targetBracket,
      budgetTracker,
      maxCardPrice,
      currency,
      ignoreOwnedBudget,
    });
    detectedCombos = floorResult.detectedCombos;
    comboBudgetSkipCount += floorResult.budgetSkipped;
  }

  // Disclose combo-completion candidates that were available but skipped for
  // exceeding the budget — the audit/combo-floor above now honor the same
  // budget gate cardPicking/scryfallFill/coherenceRepair enforce, instead of
  // silently blowing the cap (see BudgetTracker). Overwritten near the return
  // with the honest final-total/over-budget message when the shipped deck
  // actually landed over budget (mutating passes run after this point).
  let budgetNote: string | undefined;
  if (budgetTracker && comboBudgetSkipCount > 0) {
    const sym = currency === 'EUR' ? '€' : '$';
    // ponytail: count tallies per-candidate loop skips, not user-meaningful upgrades — keep the note qualitative
    budgetNote = `Some combo upgrades were skipped to honor your ${sym}${deckBudget} budget`;
  }

  // ── Post-Generation Fixup Pass (light touch) ──
  // Only fix critical gaps: roles ≤50% of target, dead CMC 1/2 slots
  if (state.edhrecData && customization.balancedRoles) {
    const MAX_FIXUP_SWAPS = 5;
    let fixupSwaps = 0;

    const fixupMustIncludeSet = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);

    // Helper: find the lowest-priority non-protected card matching a filter
    // Never evict lands — they have their own target and shouldn't be swapped for spells
    function findWeakestCard(
      filter?: (card: ScryfallCard, cat: DeckCategory) => boolean
    ): { card: ScryfallCard; category: DeckCategory } | null {
      let weakest: { card: ScryfallCard; category: DeckCategory; priority: number } | null = null;
      for (const cat of Object.keys(categories) as DeckCategory[]) {
        if (cat === 'lands') continue;
        const cards = categories[cat];
        for (let i = cards.length - 1; i >= 0; i--) {
          const card = cards[i];
          if (fixupMustIncludeSet.has(card.name.toLowerCase())) continue;
          if (comboCardNames.has(card.name)) continue;
          if (filter && !filter(card, cat)) continue;
          const priority = cards.length - i;
          if (!weakest || priority < weakest.priority) {
            weakest = { card, category: cat, priority };
          }
        }
      }
      return weakest ? { card: weakest.card, category: weakest.category } : null;
    }

    // Helper: remove a card from its category and update tracking
    function fixupRemoveCard(card: ScryfallCard, category: DeckCategory) {
      categories[category] = categories[category].filter((c) => c !== card);
      usedNames.delete(card.name);
      const role = getCardRole(card.name);
      if (role && currentRoleCounts[role] > 0) currentRoleCounts[role]--;
    }

    // Helper: add a card to the appropriate category
    function fixupAddCard(card: ScryfallCard) {
      stampRoleSubtypes(card);
      const role = getCardRole(card.name);
      routeCardByType(card, categories);
      usedNames.add(card.name);
      if (role) currentRoleCounts[role] = (currentRoleCounts[role] || 0) + 1;
    }

    // In owned-only modes, fixup swaps must never inject an unowned card —
    // restrict replacement candidates to cards the user owns.
    const ownedOnly = constrainsToCollection(collectionStrategy);
    const isOwnedCandidate = (name: string) =>
      !ownedOnly || !notInCollection(name, context.collectionNames);

    // Helper: find best EDHREC candidate for a role that's already fetched
    function findRoleCandidate(role: RoleKey): ScryfallCard | null {
      const candidates = state
        .edhrecData!.cardlists.allNonLand.filter(
          (c) =>
            !usedNames.has(c.name) &&
            !bannedCards.has(c.name) &&
            getCardRole(c.name) === role &&
            scryfallCardMap.has(c.name) &&
            isOwnedCandidate(c.name)
        )
        .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
      return candidates.length > 0 ? scryfallCardMap.get(candidates[0].name)! : null;
    }

    // 5a: Critical Role Deficits (≤50% of target)
    if (roleTargets) {
      const roleKeys: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];
      for (const role of roleKeys) {
        if (fixupSwaps >= MAX_FIXUP_SWAPS) break;
        const target = roleTargets[role] ?? 0;
        const current = currentRoleCounts[role] ?? 0;
        if (target > 0 && current <= target * 0.5) {
          const swapsForRole = Math.min(2, MAX_FIXUP_SWAPS - fixupSwaps);
          for (let i = 0; i < swapsForRole; i++) {
            const weak = findWeakestCard((card) => getCardRole(card.name) !== role);
            if (!weak) break;
            const replacement = findRoleCandidate(role);
            if (!replacement) break;
            fixupRemoveCard(weak.card, weak.category);
            fixupAddCard(replacement);
            if (swapCandidates) {
              const key = `type:${(getFrontFaceTypeLine(weak.card) || 'unknown').split(' ')[0].toLowerCase()}`;
              if (!swapCandidates[key]) swapCandidates[key] = [];
              swapCandidates[key].push(weak.card);
            }
            fixupSwaps++;
          }
        }
      }
    }

    // 5b: Dead CMC Slots (zero cards at CMC 1 or 2)
    if (!customization.tinyLeaders && !customization.advancedTargets?.curvePercentages) {
      for (const targetCmc of [1, 2]) {
        if (fixupSwaps >= MAX_FIXUP_SWAPS) break;
        const cardsAtCmc = Object.values(categories)
          .flat()
          .filter((c) => (c.cmc ?? 0) === targetCmc).length;
        if (cardsAtCmc === 0) {
          const cmcCounts: Record<number, number> = {};
          for (const cards of Object.values(categories)) {
            for (const card of cards) {
              cmcCounts[card.cmc ?? 0] = (cmcCounts[card.cmc ?? 0] || 0) + 1;
            }
          }
          const overfullEntry = Object.entries(cmcCounts)
            .filter(([cmc]) => Number(cmc) !== targetCmc)
            .sort(([, a], [, b]) => b - a)[0];
          if (overfullEntry) {
            const weak = findWeakestCard((card) => (card.cmc ?? 0) === Number(overfullEntry[0]));
            if (weak) {
              const candidates = state
                .edhrecData!.cardlists.allNonLand.filter(
                  (c) =>
                    !usedNames.has(c.name) &&
                    !bannedCards.has(c.name) &&
                    scryfallCardMap.has(c.name) &&
                    isOwnedCandidate(c.name) &&
                    (scryfallCardMap.get(c.name)!.cmc ?? 0) === targetCmc
                )
                .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
              if (candidates.length > 0) {
                const replacement = scryfallCardMap.get(candidates[0].name)!;
                fixupRemoveCard(weak.card, weak.category);
                fixupAddCard(replacement);
                if (swapCandidates) {
                  const key = `type:${(getFrontFaceTypeLine(weak.card) || 'unknown').split(' ')[0].toLowerCase()}`;
                  if (!swapCandidates[key]) swapCandidates[key] = [];
                  swapCandidates[key].push(weak.card);
                }
                fixupSwaps++;
              }
            }
          }
        }
      }
    }

    if (fixupSwaps > 0) {
      logger.debug(`[DeckGen] Fixup pass: ${fixupSwaps} swap(s) applied`);
    }
  }

  // ── Coherence Repair (E78 phase 3) ──
  // Run the coherence audit while the deck can still be mutated and repair a
  // bounded number of findings, so convergence/scoring/the final audit all see
  // the repaired list and the report shows only what repair couldn't fix.
  let coherenceRepairs: CoherenceRepair[] = [];
  {
    const repairMustInclude = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);
    const repairLiftIndex = getLiftIndex(state);
    const repairResult = await applyCoherenceRepair(state, {
      scryfallCardMap,
      detectedCombos,
      mustIncludeNames: repairMustInclude,
      cardAllowed: isCardAllowedBySynergyDependencies,
      liftedByOf: (n) => repairLiftIndex.get(n)?.liftedBy,
      isSaltBlocked,
      bracketGuard,
      gameChangerCount,
      maxGameChangers,
      budgetTracker,
      maxCardPrice,
      maxRarity,
      maxCmc,
      arenaOnly,
      currency,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      getBasicLand: async (name) =>
        getCachedCard(name) ?? (await getCardByName(name, true).catch(() => null)),
    });
    coherenceRepairs = [...comboAuditRepairs, ...repairResult.repairs];
    // A repair add can complete a tracked combo — refresh completeness against
    // the live deck (mirrors the combo-audit / convergence refresh idiom).
    if (coherenceRepairs.length > 0 && detectedCombos) {
      const liveNames = new Set<string>();
      for (const c of Object.values(categories).flat()) {
        liveNames.add(c.name);
        if (c.name.includes(' // ')) liveNames.add(frontFaceName(c.name));
      }
      if (commander) liveNames.add(commander.name);
      if (partnerCommander) liveNames.add(partnerCommander.name);
      detectedCombos = detectedCombos
        .map((dc) => {
          const missing = dc.cards.filter((n) => !liveNames.has(n));
          return { ...dc, isComplete: missing.length === 0, missingCards: missing };
        })
        .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
      if (detectedCombos.length === 0) detectedCombos = undefined;
    }
  }

  // ── Bracket Convergence ──
  // Close the loop on the target bracket: the pick-time guard caps hard-floor
  // signals, but the estimator's soft score (fast mana/tutors/low curve) can
  // still bump the deck one bracket above target. Re-run the real estimator and
  // swap soft-signal cards for neutral filler until the deck lands in-band.
  // Runs before scoring/relevancy/grade so they all see the converged deck.
  {
    const convergeMustInclude = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);
    const converge = applyBracketConvergence(state, {
      scryfallCardMap,
      detectedCombos,
      mustIncludeNames: convergeMustInclude,
      cardAllowed: isCardAllowedBySynergyDependencies,
      roleTargets,
      budgetTracker,
      maxCardPrice,
      currency,
      ignoreOwnedBudget,
    });
    // Convergence can cut a combo piece (target <= 2 breaks incidental combos).
    // Refresh combo completeness against the live deck so the final bracket
    // estimate + report don't keep a now-broken combo's floor (mirrors the
    // combo-audit refresh above).
    if (converge.applied > 0 && detectedCombos) {
      const liveNames = new Set<string>();
      for (const c of Object.values(categories).flat()) {
        liveNames.add(c.name);
        if (c.name.includes(' // ')) liveNames.add(frontFaceName(c.name));
      }
      if (commander) liveNames.add(commander.name);
      if (partnerCommander) liveNames.add(partnerCommander.name);
      detectedCombos = detectedCombos
        .map((dc) => {
          const missing = dc.cards.filter((n) => !liveNames.has(n));
          return { ...dc, isComplete: missing.length === 0, missingCards: missing };
        })
        .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
      if (detectedCombos.length === 0) detectedCombos = undefined;
    }
  }

  // ── Budget Convergence (E79) ──
  // BudgetTracker's per-pick cap is a soft greedy heuristic — nothing before
  // this point ever re-checks the ACCUMULATED total against `deckBudget`. If
  // the deck (after every prior mutating phase, including bracket convergence
  // above) is still over budget, swap expensive cards for cheaper same-role/
  // same-function alternatives until it lands at or under, or no legal swap
  // remains. Runs after bracket convergence (which can itself add a pricey
  // Game Changer) so this pass sees whatever that left behind.
  let budgetRepairs: CoherenceRepair[] = [];
  let budgetConvergedSwaps = 0;
  let budgetResidualReason: string | undefined;
  if (deckBudget !== null) {
    const budgetMustInclude = new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]);
    const budgetLiftIndex = getLiftIndex(state);
    const budgetResult = await applyBudgetConvergence(state, {
      scryfallCardMap,
      detectedCombos,
      mustIncludeNames: budgetMustInclude,
      cardAllowed: isCardAllowedBySynergyDependencies,
      liftedByOf: (n) => budgetLiftIndex.get(n)?.liftedBy,
      isSaltBlocked,
      bracketGuard,
      gameChangerCount,
      maxGameChangers,
      budgetTracker,
      maxRarity,
      maxCmc,
      arenaOnly,
      currency,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      roleTargets,
      deckBudget,
      // E79 round 4: the standard pool's leftover tail skews expensive (it's
      // what generation already picked FROM), so merge in the commander's
      // real EDHREC budget-deck pool for cheaper same-role alternatives.
      // Soft-fails to null on any error — never breaks generation.
      fetchBudgetPool: async () => {
        try {
          const budgetPoolData = await fetchCommanderData(commander.name, 'budget', targetBracket);
          const unresolvedNames = budgetPoolData.cardlists.allNonLand
            .map((c) => c.name)
            .filter((n) => !scryfallCardMap.has(n));
          const resolved =
            unresolvedNames.length > 0
              ? await getCardsByNames(unresolvedNames, undefined, preferredSet)
              : new Map<string, ScryfallCard>();
          return { pool: budgetPoolData.cardlists.allNonLand, scryfallMap: resolved };
        } catch {
          return null;
        }
      },
    });
    budgetRepairs = budgetResult.repairs;
    budgetConvergedSwaps = budgetResult.applied;
    budgetResidualReason = budgetResult.residualReason;
    // Mirrors the combo-refresh idiom above: a swap can break a tracked combo.
    if (budgetRepairs.length > 0 && detectedCombos) {
      const liveNames = new Set<string>();
      for (const c of Object.values(categories).flat()) {
        liveNames.add(c.name);
        if (c.name.includes(' // ')) liveNames.add(frontFaceName(c.name));
      }
      if (commander) liveNames.add(commander.name);
      if (partnerCommander) liveNames.add(partnerCommander.name);
      detectedCombos = detectedCombos
        .map((dc) => {
          const missing = dc.cards.filter((n) => !liveNames.has(n));
          return { ...dc, isComplete: missing.length === 0, missingCards: missing };
        })
        .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
      if (detectedCombos.length === 0) detectedCombos = undefined;
    }
  }

  // ── Role-Surplus → Payoff Conversion (E87) ──
  // Post-fill role caps still overshoot (Combo Integrity Audit's uncapped
  // auditAdd/auditRemove never updates currentRoleCounts; coherence-repair/
  // bracket-convergence/the role-cap escape hatch all admit over-cap fillers
  // without a later pass pulling them back). This bounded pass converts the
  // worst of that surplus into an actual payoff pick. Runs after every
  // mutating phase above (its fresh recount sees what actually shipped) and
  // before lift picks (so a converted-out card is excluded from resurfacing
  // as a "hidden synergy" suggestion via preSwapUsedNames below). Never
  // touches a must-include/combo-piece/staple, so — unlike budget/bracket
  // convergence — it can't break a tracked combo and needs no completeness
  // refresh after it runs.
  const surplusResult = applyRoleSurplusRebalance(state, {
    scryfallCardMap,
    roleTargets,
    detectedCombos,
    mustIncludeNames: new Set([
      ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
      ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
    ]),
    cardAllowed: isCardAllowedBySynergyDependencies,
    liftScoreOf,
    isSaltBlocked,
    bracketGuard,
    gameChangerCount,
    maxGameChangers,
    budgetTracker,
    maxCardPrice,
    maxRarity,
    maxCmc,
    arenaOnly,
    currency,
    ignoreOwnedBudget,
    ignoreOwnedRarity,
    deckBudget,
  });
  const surplusConversions = surplusResult.conversions;

  // ── Final combo-state reconciliation ──
  // Every mutating phase above (reconcile, combo audit, coherence repair,
  // bracket/budget convergence, role-surplus rebalance) already has its OWN
  // conditional isComplete/missingCards refresh gated on "did THIS phase
  // change anything" — easy to miss on a new pass (role-surplus-rebalance's
  // own comment above claims it "can't break a tracked combo," which is only
  // as true as every one of its skip conditions holding). Rather than trust
  // N scattered gated refreshes to all fire correctly, do ONE unconditional
  // recompute here against the truly-final `state.categories`, right before
  // detectedCombos feeds cardRelevancyPhase/computeGradeAndBracket/the report
  // below — a stale isComplete:true (and the bracketEstimation
  // twoCardComboCount/multiCardComboCount it drives) can no longer survive a
  // cut piece, no matter which upstream phase caused it. No-op — byte-
  // identical — whenever nothing actually changed completeness.
  detectedCombos = refreshComboCompleteness(detectedCombos, state);

  // Emergent combo-completion disclosure: diff the truly-final detectedCombos
  // just refreshed above against the generation-start baseline captured
  // right after must-includes were seeded (state.baselineDetectedCombos) —
  // whatever completed in between is credit to the algorithm's own picks,
  // not the user's must-includes. Composed here (not earlier) so it
  // reconciles to the final deck by construction: nothing after this point
  // changes combo membership.
  const baselineCompleteIds = new Set(
    (state.baselineDetectedCombos ?? []).filter((dc) => dc.isComplete).map((dc) => dc.comboId)
  );
  const newlyCompletedCombos = (detectedCombos ?? []).filter(
    (dc) => dc.isComplete && !baselineCompleteIds.has(dc.comboId)
  );
  const comboCompletionNotes = buildComboCompletionNote(newlyCompletedCombos);

  // Hidden-synergy "package picks": EDHREC lift candidates not in the pool
  // for this commander but strongly co-played with cards already in the
  // deck. Suggestions only — never added to the deck. Runs here, AFTER every
  // mutating phase (combo audit, fixup, coherence repair, bracket
  // convergence), so its exclusion set reflects the deck that actually
  // shipped — not a pre-swap snapshot that can suggest a card the deck no
  // longer runs, or re-suggest a card those very phases just cut.
  const liftPicks = await liftPicksPhase(state, {
    effectiveScryfallQuery: scryfallQuery,
    isSaltBlocked,
    extraExcludeNames: new Set([...preSwapUsedNames].filter((name) => !usedNames.has(name))),
  });

  // Build deck score from EDHREC inclusion percentages
  const { deckScore, cardInclusionMap } = deckScorePhase(state, swapCandidates, gapAnalysis);

  // Build per-card relevancy scores (composite: synergy + inclusion + role deficit + curve fit + type balance)
  const cardRelevancyMap = cardRelevancyPhase(
    state,
    roleTargets,
    curveTargets,
    typeTargets,
    swapCandidates,
    gapAnalysis,
    detectedCombos
  );

  // ── Grade + bracket ──
  const allDeckCardNames = Object.values(categories)
    .flat()
    .map((c) => c.name);
  if (commander) allDeckCardNames.push(commander.name);
  if (partnerCommander) allDeckCardNames.push(partnerCommander.name);
  // Final stats, computed HERE (after the combo-floor / fixup / coherence-
  // repair / bracket-convergence swap passes) rather than at deck-assembly
  // time — a stats snapshot taken before those passes goes stale the moment
  // any of them mutate the deck (convergence in particular systematically
  // removes 0-cmc fast mana), producing a persisted `stats.averageCmc` that
  // disagrees with the bracket estimate's own independently-fresh recompute,
  // plus a manaCurve/typeDistribution that can miss a swap's add or cut
  // entirely. This is the single source now — nothing downstream recomputes
  // it again.
  const nonLandCards = (Object.entries(categories) as [DeckCategory, ScryfallCard[]][])
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards);
  // Single source for the SHIPPED role counts: recount from the final card set
  // via the same shared computeRoleCounts() the manual-deck/edit path uses,
  // rather than trusting the ad-hoc `currentRoleCounts` incremental tally
  // (which several backfill/fixup call sites bump even for lands routed into
  // categories.lands, drifting from the per-card role fields it's supposed to
  // mirror). `currentRoleCounts` itself stays untouched — it's still the live
  // counter driving in-flight picking/fixup decisions during generation.
  const finalRoleCounts = computeRoleCounts(nonLandCards).roleCounts;
  const stats = await finalStatsPhase(state, saltIndex);
  const { bracketEstimation, deckGrade } = computeGradeAndBracket({
    allCardNames: allDeckCardNames,
    detectedCombos,
    averageCmc: stats.averageCmc,
    deckScore,
    bracketRoleCounts: roleTargets ? finalRoleCounts : undefined,
    gameChangerNames: state.gameChangerNames,
    allCards: Object.values(categories).flat(),
    roleCounts: finalRoleCounts,
    roleTargets,
    edhrecData: state.edhrecData,
    deckSize: format,
    cardInclusionMap,
    colorIdentity: context.colorIdentity,
    // Grade against the SAME land-count target the generator actually built
    // to (flat default or archetype-aware auto-tune) — otherwise the grader
    // computes its own independent "ideal" and contradicts its own generator.
    overrideLandTarget: resolvedLandCount,
    overridePacing: resolvedPacing,
  });
  logger.debug(
    `[DeckGen] Bracket estimation: ${bracketEstimation.bracket} (${bracketEstimation.label}), soft score: ${bracketEstimation.softScore}`
  );

  // landCountNote, composed HERE (not at auto-tune decision time) from the
  // same final `categories`/`stats` everything else above now single-sources:
  // the decision to note at all was made early (before any card was picked),
  // but coherence-repair/bracket-convergence can still change the delivered
  // land count and curve afterward — composing the string this late is the
  // only way its numbers can't go stale relative to what actually shipped.
  if (landCountAutoTuned) {
    landCountNote = buildLandCountNote({
      resolvedLandCount,
      finalLandCount: categories.lands.length,
      archetype: detectedArchetype ?? Archetype.GOODSTUFF,
      isLowConfidence: archetypeIsLowConfidence,
      edhrecRampCount: edhrecRampCountForNote ?? 0,
      finalAvgCmc: stats.averageCmc,
    });
  }

  // Budget honesty: recompute the real final total over the FINAL deck (post
  // combo-floor/fixup/coherence-repair/bracket-convergence swaps) — the early
  // budgetTracker log above runs before those mutating passes and only ever
  // disclosed a skip count, never a total, so it can't say whether the deck
  // actually landed over budget. Overwrite budgetNote with the honest number
  // when it did, folding in the skip disclosure as a secondary clause.
  if (deckBudget !== null) {
    const finalTotal = [...nonLandCards, ...categories.lands].reduce((sum, c) => {
      const p = getCardPrice(c, currency);
      return sum + (p ? parseFloat(p) || 0 : 0);
    }, 0);
    budgetNote =
      buildOverBudgetNote({
        finalTotal,
        deckBudget,
        currency,
        comboBudgetSkipCount,
        convergedSwapCount: budgetConvergedSwaps,
        residualReason: budgetResidualReason,
      }) ?? budgetNote;
  }

  // Surfaced relaxation count = relaxed cards that SURVIVED the combo audit /
  // fixup passes above (they can evict cards added to categories.synergy), so
  // the report never overstates what actually came from outside the collection.
  const finalNames = new Set(
    Object.values(categories)
      .flat()
      .map((c) => c.name)
  );
  if (relaxedNames.size > 0) {
    for (const n of relaxedNames) if (finalNames.has(n)) collectionRelaxedCount += 1;
  }
  // Keep only substitutions whose owned card survived the audit/fixup passes.
  const survivingSubstitutions = substitutionRows.filter((r) => finalNames.has(r.usedName));

  // Bounded to the final deck (not the whole lift index) so the build report
  // only explains cards actually in the deck.
  const finalLiftIndex = getLiftIndex(state);
  const liftedByMap: Record<string, string[]> = {};
  for (const name of finalNames) {
    const entry = finalLiftIndex.get(name.toLowerCase());
    if (entry) liftedByMap[name.toLowerCase()] = entry.liftedBy;
  }

  // Manabase self-explanation over the FINAL deck (post trim/audit/padding):
  // sources built vs castability-weighted targets per color.
  const manabase = buildManabaseSummary(categories.lands, nonLandCards, new Set(colorIdentity));

  // Role-cap escape-hatch disclosure (E77 iter-4 round 2) — aggregated across
  // every gated path over the whole generation; undefined when the cap was
  // never actually breached.
  const roleCapOverflowNote = buildRoleCapOverflowNote(roleCapOverflowCounts);

  // Price-sanity disclosure (E80) — undefined when the tie-break never
  // actually decided an outcome (off, or no qualifying pair arose).
  const priceSanityNote = buildPriceSanityNote(priceSanityDecided.size);

  // Land-squeeze reconciliation disclosure (E88 + E82 attempt 6) — undefined
  // when the auto-tune never raised land count past baseline AND the
  // wildcard scan never found a leftover card worth adding (the common
  // case). Reconciled to the final deck first (see
  // reconcileLandSqueezeDisclosure's doc) — everything downstream of the
  // reconcile phase has already run by this point, so `nonLandCards` is the
  // true final set.
  const { cut: finalLandSqueezeCut, wildcardsKept: finalWildcardsKept } =
    reconcileLandSqueezeDisclosure(
      landSqueezeResult.cut,
      landSqueezeResult.wildcardsKept,
      new Set(nonLandCards.map((c) => c.name))
    );
  const landSqueezeTrimNote = buildLandSqueezeTrimNote(
    finalLandSqueezeCut,
    finalWildcardsKept,
    categories.lands.length,
    DEFAULT_LAND_COUNT
  );

  // Combo-upside price disclosure — post-hoc scan of the FINAL deck against
  // the FINAL detectedCombos (post trim/audit/repair, mutated in place above)
  // and the batch-fetched EDHREC pool, so a card carrying a live combo boost
  // only gets disclosed while its combo is still genuinely incomplete AND a
  // cheaper same-role alternative genuinely existed.
  const comboUpsideNotes = buildComboUpsideNotes(
    nonLandCards,
    staticComboBoosts,
    detectedCombos,
    state.edhrecData,
    scryfallCardMap,
    currency
  );

  // Coherence audit over the FINAL deck (detection only): the pick-time
  // dependency gate can't see support that a later swap pass trimmed away, and
  // some fill paths never route through it — so re-check every shipped card
  // once nothing can mutate the deck anymore.
  const coherenceFindings = auditDeckCoherence({
    nonLandCards,
    commanders: [commander, partnerCommander].filter((c): c is ScryfallCard => c != null),
    cardInclusionMap,
    liftedByMap,
    detectedCombos,
    roleOf: getCardRole,
    lands: categories.lands,
    manabase,
    format: 'commander', // the deck builder only generates Commander-family decks
    colorIdentity, // enables the answer-coverage matrix (E79)
  });

  return {
    commander,
    partnerCommander,
    categories,
    stats,
    usedThemes,
    gapAnalysis,
    packagePicks: liftPicks?.packagePicks,
    liftPicksNote: liftPicks?.liftPicksNote,
    manabase,
    coherenceFindings: coherenceFindings.length > 0 ? coherenceFindings : undefined,
    coherenceRepairs: coherenceRepairs.length > 0 ? coherenceRepairs : undefined,
    budgetRepairs: budgetRepairs.length > 0 ? budgetRepairs : undefined,
    surplusConversions: surplusConversions.length > 0 ? surplusConversions : undefined,
    liftedByMap: Object.keys(liftedByMap).length > 0 ? liftedByMap : undefined,
    detectedCombos,
    collectionShortfall:
      context.collectionNames && basicLandFillCount > 0 ? basicLandFillCount : undefined,
    filterShortfall:
      scryfallQuery && !context.collectionNames && basicLandFillCount > 0
        ? basicLandFillCount
        : undefined,
    collectionRelaxedCount: collectionRelaxedCount > 0 ? collectionRelaxedCount : undefined,
    collectionSubstitutions: survivingSubstitutions.length > 0 ? survivingSubstitutions : undefined,
    typeTargets,
    dataSource: state.dataSource,
    bracketPoolFallbackNote: state.bracketPoolFallbackNote,
    generationMode: mode,
    generationModeDetail: altPool?.detail,
    generationRelaxedNote: altPool?.relaxedNote,
    landCountNote,
    budgetNote,
    roleCapOverflowNote,
    priceSanityNote,
    landSqueezeTrimNote,
    comboUpsideNotes,
    comboCompletionNotes,
    roleCounts: roleTargets ? { ...finalRoleCounts } : undefined,
    roleTargets: roleTargets ? { ...roleTargets } : undefined,
    roleTargetBreakdown,
    ...(roleTargets
      ? (() => {
          const rampSub: Record<string, number> = {
            'mana-producer': 0,
            'mana-rock': 0,
            'cost-reducer': 0,
            ramp: 0,
          };
          const removalSub: Record<string, number> = {
            counterspell: 0,
            bounce: 0,
            'spot-removal': 0,
            removal: 0,
          };
          const boardwipeSub: Record<string, number> = { 'bounce-wipe': 0, boardwipe: 0 };
          const cardDrawSub: Record<string, number> = {
            tutor: 0,
            wheel: 0,
            cantrip: 0,
            'card-draw': 0,
            'card-advantage': 0,
          };
          for (const cards of Object.values(categories)) {
            for (const card of cards) {
              if (card.rampSubtype)
                rampSub[card.rampSubtype] = (rampSub[card.rampSubtype] || 0) + 1;
              if (card.removalSubtype)
                removalSub[card.removalSubtype] = (removalSub[card.removalSubtype] || 0) + 1;
              if (card.boardwipeSubtype)
                boardwipeSub[card.boardwipeSubtype] =
                  (boardwipeSub[card.boardwipeSubtype] || 0) + 1;
              if (card.cardDrawSubtype)
                cardDrawSub[card.cardDrawSubtype] = (cardDrawSub[card.cardDrawSubtype] || 0) + 1;
            }
          }
          return {
            rampSubtypeCounts: rampSub,
            removalSubtypeCounts: removalSub,
            boardwipeSubtypeCounts: boardwipeSub,
            cardDrawSubtypeCounts: cardDrawSub,
          };
        })()
      : {}),
    swapCandidates,
    deckScore,
    cardInclusionMap,
    cardRelevancyMap,
    detectedArchetype,
    detectedPacing,
    bracketEstimation,
    gameChangerNames: [...state.gameChangerNames],
    deckGrade,
  };
}
