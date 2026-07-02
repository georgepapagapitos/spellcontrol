import { logger } from '@/lib/logger';
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
} from '@/deck-builder/services/edhrec/client';
import {
  loadTaggerData,
  hasTaggerData,
  getCardRole,
  getCardSubtype,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { computeGradeAndBracket } from './commanderDeckAnalysis';
import { getDynamicRoleTargets, estimatePacingFromStats } from './roleTargets';
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
import { calculateTargetCounts } from './targetCounts';
import { BudgetTracker } from './budgetTracker';
import { BracketGuard, bracketCeilings, ceilingsAreOpen } from './bracketGuard';
import {
  pickFromPrefetchedWithCurve,
  mergeWithAllNonLand,
  calculateCardPriority,
  isHighSynergyCard,
} from './cardPicking';
import {
  categorizeCards,
  stampRoleSubtypes,
  collectSwapCandidates,
  computeRoleBoosts,
} from './categorize';
import { fillWithScryfall, type FillHardGates } from './scryfallFill';
import { isUnsupportedSynergyPayoff } from './synergyDependency';
import { buildManabaseSummary } from './manabaseMath';
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
import { detectCombosPhase } from './deckGeneration/phaseDetectCombos';
import { gapAnalysisPhase } from './deckGeneration/phaseGapAnalysis';
import { liftPicksPhase } from './deckGeneration/phaseLiftPicks';
import { ensureLiftPools, getLiftIndex, MAX_LIFT_SEEDS } from './deckGeneration/liftPools';
import { deckScorePhase } from './deckGeneration/phaseDeckScore';
import { cardRelevancyPhase } from './deckGeneration/phaseCardRelevancy';
import { stapleManaRocksPhase } from './deckGeneration/phaseStapleManaRocks';
import { finalStatsPhase } from './deckGeneration/phaseFinalStats';
import { applyComboFloor } from './deckGeneration/phaseApplyComboFloor';
import { applyBracketConvergence } from './deckGeneration/phaseBracketConverge';
import { frontFaceName } from '@/lib/card-text';

// Re-exported so existing consumers keep importing from here (stable public API).
export { calculateStats } from './deckStats';
export { stampRoleSubtypes } from './categorize';
export { CHANNEL_LAND_BOOST, MDFC_LAND_BOOST } from './landGenerator';
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
  let detectedArchetype: import('@/deck-builder/types').Archetype | undefined;
  // resolvedPacing is set after edhrecData is available; detectedPacing mirrors it for the return value
  let resolvedPacing: Pacing = 'balanced';
  let detectedPacing: Pacing = 'balanced';
  let swapCandidates: Record<string, ScryfallCard[]> | undefined;

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
      // Catch each theme fetch individually so one theme's 404/network error
      // doesn't discard the themes that succeeded (F14). We fall back to base
      // commander data only if EVERY theme fetch fails (below).
      const themeDataPromises = selectedThemesWithSlugs.map((theme) =>
        (partnerCommander
          ? fetchPartnerThemeData(
              commander.name,
              partnerCommander.name,
              theme.slug!,
              budgetOption,
              targetBracket
            )
          : fetchCommanderThemeData(commander.name, theme.slug!, budgetOption, targetBracket)
        ).catch((err) => {
          logger.warn(`[DeckGen] theme fetch failed, skipping "${theme.slug}":`, err);
          return null;
        })
      );

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

      const [themeDataRaw, fetchedBaseData] = await Promise.all([
        Promise.all(themeDataPromises),
        baseDataPromise,
      ]);
      state.baseData = fetchedBaseData;

      // Keep only the themes that resolved. If every theme failed, bail to the
      // base-commander fallback in the catch below rather than merging nothing.
      const themeDataResults = themeDataRaw.filter((r): r is NonNullable<typeof r> => r != null);
      if (themeDataResults.length === 0) {
        throw new Error('All theme-specific EDHREC fetches failed');
      }

      // Merge cardlists from all (surviving) themes
      const merged = mergeThemeCardlists(themeDataResults);
      const mergedCardlists = merged.cardlists;
      state.themeOverlapCounts = merged.themeOverlapCounts;

      // Use the first theme's stats as representative, but if the theme endpoint
      // lacks type distribution data (numDecks=0), fetch base commander stats instead
      let representativeStats = themeDataResults[0].stats;
      if (!representativeStats.numDecks || representativeStats.numDecks === 0) {
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
          // Try without bracket if bracket-specific base also fails
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

      state.dataSource = targetBracket ? 'theme+bracket' : 'theme';
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
      onProgress?.('Your commander heeds the call…', 12);
    } catch (error) {
      logger.warn('[DeckGen] FALLBACK: Base commander+bracket fetch failed:', error);
      if (targetBracket) {
        try {
          state.edhrecData = partnerCommander
            ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
            : await fetchCommanderData(commander.name, budgetOption);
          state.dataSource = 'base';
          logger.debug('[DeckGen] FALLBACK: Using base commander data (no bracket)');
          onProgress?.('Your commander heeds the call…', 12);
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

  // Calculate target counts with type and curve targets
  const {
    composition: targets,
    typeTargets,
    curveTargets,
  } = calculateTargetCounts(
    customization,
    state.edhrecData?.stats,
    !!partnerCommander,
    resolvedPacing
  );

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
      ignoreOwnedRarity
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
    const creaturePool = mergeWithAllNonLand(cardlists.creatures, cardlists.allNonLand);
    const instantTarget = Math.max(
      0,
      (typeTargets.instant ?? 0) - (preFilledTypeCounts.instant ?? 0)
    );
    const instantPool = mergeWithAllNonLand(cardlists.instants, cardlists.allNonLand);
    const sorceryTarget = Math.max(
      0,
      (typeTargets.sorcery ?? 0) - (preFilledTypeCounts.sorcery ?? 0)
    );
    const sorceryPool = mergeWithAllNonLand(cardlists.sorceries, cardlists.allNonLand);
    const artifactTarget = Math.max(
      0,
      (typeTargets.artifact ?? 0) - (preFilledTypeCounts.artifact ?? 0)
    );
    const artifactPool = mergeWithAllNonLand(cardlists.artifacts, cardlists.allNonLand);
    const enchantmentTarget = Math.max(
      0,
      (typeTargets.enchantment ?? 0) - (preFilledTypeCounts.enchantment ?? 0)
    );
    const enchantmentPool = mergeWithAllNonLand(cardlists.enchantments, cardlists.allNonLand);
    const planeswalkerTarget = Math.max(
      0,
      (typeTargets.planeswalker ?? 0) - (preFilledTypeCounts.planeswalker ?? 0)
    );
    const planeswalkerPool = mergeWithAllNonLand(cardlists.planeswalkers, cardlists.allNonLand);

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
        customization.advancedTargets?.edhrecInclusionThreshold ?? null
      );
      roleTargets = dynamic.targets;
      detectedArchetype = dynamic.archetype;
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
          const role = getCardRole(scryfallCard.name);
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
        const role = getCardRole(card.name);
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
      creatureBoosts,
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
      liftTieBreak
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
        fillGates
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
      instantBoosts,
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
      liftTieBreak
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
      sorceryBoosts,
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
      liftTieBreak
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
      artifactBoosts,
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
      liftTieBreak
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
      enchantmentBoosts,
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
      liftTieBreak
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
        planeswalkerBoosts,
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
        liftTieBreak
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
  await stapleManaRocksPhase(state);

  // Calculate the target deck size (commander(s) are separate)
  // With partner, we need one fewer card since both commanders count toward the total
  const commanderCount = partnerCommander ? 2 : 1;
  const targetDeckSize = format === 99 ? 100 - commanderCount : format - commanderCount;

  // Helper to count all cards
  const countAllCards = () => stCountAllCards(state);

  // ── Smart Trim: priority-aware, role-aware, combo-aware ──
  const MUST_INCLUDE_BOOST = 10000;
  const COMBO_TRIM_BOOST = 200;
  const ROLE_DEFICIT_TRIM_BOOST = 50;
  const ROLE_SURPLUS_TRIM_PENALTY = -30;

  let currentCount = countAllCards();
  if (currentCount > targetDeckSize) {
    const trimCandidates: { card: ScryfallCard; category: DeckCategory; trimResistance: number }[] =
      [];

    // Protect lands: calculate how many non-must-include lands we can afford to trim
    const currentLandCount = categories.lands.length;
    const landTrimBudget = Math.max(0, currentLandCount - targets.lands);
    const LAND_PROTECTION_BOOST = 5000; // below must-include but above everything else

    for (const cat of Object.keys(categories) as DeckCategory[]) {
      const cards = categories[cat];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        // Position-based priority: cards are in priority order (index 0 = highest)
        // So higher index = lower priority = lower trim resistance
        let resistance = cards.length - i;

        // Untouchable: must-include cards (check the card's flag, not just the customization arrays,
        // so applied include lists and optimize deck cards are also protected)
        if (card.isMustInclude) {
          resistance += MUST_INCLUDE_BOOST;
        }

        // Protect lands from being trimmed below the user's land target
        if (cat === 'lands' && !card.isMustInclude) {
          resistance += LAND_PROTECTION_BOOST;
        }

        // Soft-protected: combo pieces
        if (comboCardNames.has(card.name)) {
          resistance += COMBO_TRIM_BOOST;
        }

        // Role-aware: protect deficit roles, expose surplus roles
        if (roleTargets) {
          const role = getCardRole(card.name);
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
        const role = getCardRole(card.name);
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

        // If advanced type overrides are active, prioritize cards that fill type deficits
        if (customization.advancedTargets?.typePercentages && totalTypeNeed > 0) {
          const cardType = getSimpleCardType(getFrontFaceTypeLine(scryfallCard).toLowerCase());
          // Skip cards of types the user set to 0 (or already at target)
          if (cardType && typeNeed[cardType] <= 0) continue;
          // Track the fill
          if (cardType && typeNeed[cardType] > 0) typeNeed[cardType]--;
        }

        categories.synergy.push(scryfallCard);
        usedNames.add(edhrecCard.name);
        if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
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

          categories.synergy.push(scryfallCard);
          usedNames.add(edhrecCard.name);
          if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
          filled++;
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
          fillGates
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
          fillGates
        );
        categories.synergy.push(...moreCards);
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
      const addOwnedCard = (card: ScryfallCard) => {
        stampRoleSubtypes(card);
        const role = getCardRole(card.name);
        const typeLine = getFrontFaceTypeLine(card).toLowerCase();
        if (typeLine.includes('creature')) categories.creatures.push(card);
        else if (role === 'boardwipe') categories.boardWipes.push(card);
        else if (role === 'removal') categories.singleRemoval.push(card);
        else if (role === 'ramp') categories.ramp.push(card);
        else if (role === 'cardDraw') categories.cardDraw.push(card);
        else categories.synergy.push(card);
        usedNames.add(card.name);
        if (role) currentRoleCounts[role] = (currentRoleCounts[role] || 0) + 1;
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
            addOwnedCard(card);
            substitutionRows.push(row);
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
          addOwnedCard(c);
          if (notInCollection(c.name, context.collectionNames)) relaxedNames.add(c.name);
        }
        if (relaxedCards.length > 0) {
          logger.debug(
            `[DeckGen] Collection exhausted — relaxed to ${relaxedCards.length} cards from outside it`
          );
        }
      }
    }

    // If STILL short, add basic lands as absolute last resort
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const remainingShortage = targetDeckSize - currentCount;
      basicLandFillCount = remainingShortage;
      logger.debug(`[DeckGen] Still need ${remainingShortage} more cards, adding basic lands`);

      const basicTypes: Record<string, string> = {
        W: 'Plains',
        U: 'Island',
        B: 'Swamp',
        R: 'Mountain',
        G: 'Forest',
      };
      const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

      if (colorsWithBasics.length > 0) {
        // Distribute proportional to mana pips
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
              landsPerColor[color] = remainingShortage - assigned;
            } else {
              landsPerColor[color] = Math.round(
                (remainingShortage * (pipCounts[color] || 0)) / totalPips
              );
              assigned += landsPerColor[color];
            }
          }
        } else {
          const perColor = Math.floor(remainingShortage / colorsWithBasics.length);
          const remainder = remainingShortage % colorsWithBasics.length;
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
          for (let j = 0; j < remainingShortage; j++) {
            categories.lands.push({ ...wastesCard });
          }
        }
      }
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

  // Calculate stats
  const stats = await finalStatsPhase(state, saltIndex);

  // Get the theme names that were actually used
  const usedThemes =
    selectedThemesWithSlugs.length > 0 ? selectedThemesWithSlugs.map((t) => t.name) : undefined;

  // Gap analysis: find top unowned cards that would improve the deck
  const gapAnalysis = await gapAnalysisPhase(state, { effectiveScryfallQuery: scryfallQuery });

  // Hidden-synergy "package picks": EDHREC lift candidates not in the pool
  // for this commander but strongly co-played with cards already in the
  // deck. Suggestions only — never added to the deck.
  const liftPicks = await liftPicksPhase(state, {
    effectiveScryfallQuery: scryfallQuery,
    isSaltBlocked,
  });

  // Detect combos present in the generated deck
  let detectedCombos = detectCombosPhase(state);

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
    }

    function auditAdd(card: ScryfallCard): boolean {
      if (usedNames.has(card.name)) return false; // guard against duplicates
      if (bannedCards.has(card.name)) return false; // respect banlist
      stampRoleSubtypes(card);
      const role = getCardRole(card.name);
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('creature')) categories.creatures.push(card);
      else if (role === 'boardwipe') categories.boardWipes.push(card);
      else if (role === 'removal') categories.singleRemoval.push(card);
      else if (role === 'ramp') categories.ramp.push(card);
      else if (role === 'cardDraw') categories.cardDraw.push(card);
      else categories.synergy.push(card);
      usedNames.add(card.name);
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
        const weak = auditWeakest();
        if (!weak) break;
        auditRemove(weak.card, weak.category);
        if (auditAdd(card)) {
          auditSwaps++;
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
        .filter((c): c is ScryfallCard => !!c);

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
          let found: { card: ScryfallCard; category: DeckCategory } | null = null;
          for (const cat of Object.keys(categories) as DeckCategory[]) {
            const card = categories[cat].find((c) => c.name === orphanName);
            if (card) {
              found = { card, category: cat };
              break;
            }
          }
          if (!found) continue;
          const replacement = state.edhrecData.cardlists.allNonLand
            .filter(
              (c) =>
                !usedNames.has(c.name) &&
                !bannedCards.has(c.name) &&
                scryfallCardMap.has(c.name) &&
                !(
                  constrainsToCollection(collectionStrategy) &&
                  notInCollection(c.name, context.collectionNames)
                )
            )
            .sort((a, b) => b.inclusion - a.inclusion)[0];
          if (!replacement) continue;
          auditRemove(found.card, found.category);
          auditAdd(scryfallCardMap.get(replacement.name)!);
          auditSwaps++;
          logger.debug(
            `[DeckGen] Combo audit: evicted orphan ${orphanName} (${auditInclusion.get(orphanName) ?? 0}% inclusion) → ${replacement.name}`
          );
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
    });
    detectedCombos = floorResult.detectedCombos;
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
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('creature')) {
        categories.creatures.push(card);
      } else if (role === 'boardwipe') {
        categories.boardWipes.push(card);
      } else if (role === 'removal') {
        categories.singleRemoval.push(card);
      } else if (role === 'ramp') {
        categories.ramp.push(card);
      } else if (role === 'cardDraw') {
        categories.cardDraw.push(card);
      } else {
        categories.synergy.push(card);
      }
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

  // Build deck score from EDHREC inclusion percentages
  const { deckScore, cardInclusionMap } = deckScorePhase(state, swapCandidates, gapAnalysis);

  // Build per-card relevancy scores (composite: synergy + inclusion + role deficit + curve fit + type balance)
  const cardRelevancyMap = cardRelevancyPhase(
    state,
    roleTargets,
    curveTargets,
    typeTargets,
    swapCandidates,
    gapAnalysis
  );

  // ── Grade + bracket ──
  const allDeckCardNames = Object.values(categories)
    .flat()
    .map((c) => c.name);
  if (commander) allDeckCardNames.push(commander.name);
  if (partnerCommander) allDeckCardNames.push(partnerCommander.name);
  // Recompute the non-land average CMC from the FINAL deck: `stats` was taken
  // before the combo-floor / fixup / bracket-convergence swap passes, so its
  // averageCmc is stale (convergence in particular systematically removes
  // 0-cmc fast mana). The bracket estimate must score the deck as it ships, so
  // the report matches what convergence verified. Uses the SAME non-land basis
  // the convergence pass scored on (every category except `lands`) so the two
  // estimates agree exactly.
  const nonLandCards = (Object.entries(categories) as [DeckCategory, ScryfallCard[]][])
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards);
  const finalAverageCmc =
    nonLandCards.length > 0
      ? nonLandCards.reduce((sum, c) => sum + (c.cmc ?? 0), 0) / nonLandCards.length
      : stats.averageCmc;
  const { bracketEstimation, deckGrade } = computeGradeAndBracket({
    allCardNames: allDeckCardNames,
    detectedCombos,
    averageCmc: finalAverageCmc,
    deckScore,
    bracketRoleCounts: roleTargets ? currentRoleCounts : undefined,
    gameChangerNames: state.gameChangerNames,
    allCards: Object.values(categories).flat(),
    roleCounts: currentRoleCounts,
    roleTargets,
    edhrecData: state.edhrecData,
    deckSize: format,
    cardInclusionMap,
    colorIdentity: context.colorIdentity,
  });
  logger.debug(
    `[DeckGen] Bracket estimation: ${bracketEstimation.bracket} (${bracketEstimation.label}), soft score: ${bracketEstimation.softScore}`
  );

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
    generationMode: mode,
    generationModeDetail: altPool?.detail,
    generationRelaxedNote: altPool?.relaxedNote,
    roleCounts: roleTargets ? { ...currentRoleCounts } : undefined,
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
