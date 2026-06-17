// Shared state bag for the generateDeck orchestrator.
//
// generateDeck is being decomposed into named phase functions (see the plan in
// the repo's refactor notes). For a behavior-preservation refactor the lowest-
// risk threading model is a single mutable state object whose container
// identities are stable for the whole run: extracting a phase becomes a
// mechanical `foo` -> `state.foo` rename with no control-flow changes.
//
// `cfg` holds the once-derived, immutable config snapshot (verbatim copies of
// the values generateDeck computed at the top of its body). The remaining
// fields are the mutable containers and mid-life "result" locals threaded
// across phases, each initialized to exactly the value generateDeck used.
import type {
  ScryfallCard,
  DeckCategory,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  DeckDataSource,
  Customization,
  ThemeResult,
  Pacing,
  RoleTargetBreakdown,
  Archetype,
  TargetBracket,
  BudgetOption,
  GapAnalysisCard,
  DetectedCombo,
  DeckStats,
  GeneratedDeck,
} from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import type { SubstituteCandidate } from '@/deck-builder/services/deckBuilder/substituteFinder';
import { parseSetFromQuery } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';

export interface GenerationContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  customization: Customization;
  selectedThemes?: ThemeResult[];
  collectionNames?: Set<string>;
  collectionAvailableCounts?: Map<string, number>;
  /**
   * Lean owned-card pool (name + color identity + CMC + type line) for the
   * owned-only relaxation step: when the EDHREC pool can't fill an owned-only
   * deck, we substitute the closest card the user *owns* (similarity-ranked)
   * instead of reaching outside the collection. Only the available copies —
   * cards whose every copy is committed to another deck are excluded upstream.
   */
  collectionPool?: SubstituteCandidate[];
  optimizeDeckCards?: string[];
  onProgress?: (message: string, percent: number) => void;
}

// Immutable config snapshot — verbatim from generateDeck's top-of-body derivations.
export interface GenerationConfig {
  format: Customization['deckFormat'];
  maxCardPrice: number | null;
  budgetOption: BudgetOption | undefined;
  targetBracket: TargetBracket | undefined;
  maxRarity: Customization['maxRarity'];
  maxCmc: number | null;
  arenaOnly: boolean;
  scryfallQuery: string;
  preferredSet: string | undefined;
  maxGameChangers: number;
  deckBudget: number | null;
  currency: 'USD' | 'EUR';
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  collectionStrategy: Customization['collectionStrategy'];
  collectionOwnedPercent: number;
  comboCountSetting: number;
  selectedThemesWithSlugs: ThemeResult[];
}

export interface GenerationState {
  context: GenerationContext;
  cfg: GenerationConfig;

  // --- Mutable containers (stable identity for the whole run) ---
  usedNames: Set<string>;
  bannedCards: Set<string>;
  categories: Record<DeckCategory, ScryfallCard[]>;
  currentCurveCounts: Record<number, number>;
  currentRoleCounts: Record<RoleKey, number>;
  currentSubtypeCounts: Record<string, number>;
  staticComboBoosts: Map<string, number>;
  comboCardNames: Set<string>;
  comboCards: Map<string, Set<string>>;
  gameChangerCount: { value: number };
  mustIncludeNames: string[];
  mustIncludeSources: Map<string, 'user' | 'deck' | 'combo'>;
  saltIndex: Map<string, number>;

  // --- Mid-life "result" locals (assigned by one phase, read later) ---
  gameChangerNames: Set<string>;
  combos: EDHRECCombo[];
  edhrecData: EDHRECCommanderData | null;
  dataSource: DeckDataSource;
  baseData: EDHRECCommanderData | null;
  themeOverlapCounts: Map<string, number>;
  roleTargets: Record<RoleKey, number> | null;
  roleTargetBreakdown: Record<RoleKey, RoleTargetBreakdown> | undefined;
  detectedArchetype: Archetype | undefined;
  resolvedPacing: Pacing;
  detectedPacing: Pacing;
  swapCandidates: Record<string, ScryfallCard[]> | undefined;
  detectedCombos: DetectedCombo[] | undefined;
  gapAnalysis: GapAnalysisCard[] | undefined;
  deckScore: number | undefined;
  cardInclusionMap: Record<string, number> | undefined;
  cardRelevancyMap: Record<string, number> | undefined;
  stats: DeckStats | undefined;
  representativeStats: EDHRECCommanderStats | undefined;
  usedThemes: string[] | undefined;
}

export function createState(context: GenerationContext): GenerationState {
  const { customization } = context;

  const cfg: GenerationConfig = {
    format: customization.deckFormat,
    maxCardPrice: customization.maxCardPrice ?? null,
    budgetOption: customization.budgetOption !== 'any' ? customization.budgetOption : undefined,
    targetBracket: customization.targetBracket !== 'all' ? customization.targetBracket : undefined,
    maxRarity: customization.maxRarity ?? null,
    maxCmc: customization.tinyLeaders ? 3 : null,
    arenaOnly: !!customization.arenaOnly,
    scryfallQuery: customization.scryfallQuery ?? '',
    preferredSet: parseSetFromQuery(customization.scryfallQuery ?? ''),
    maxGameChangers:
      customization.gameChangerLimit === 'none'
        ? 0
        : customization.gameChangerLimit === 'unlimited'
          ? Infinity
          : customization.gameChangerLimit,
    deckBudget: customization.deckBudget ?? null,
    currency: customization.currency ?? 'USD',
    ignoreOwnedBudget: !!(customization.ignoreOwnedBudget && context.collectionNames),
    ignoreOwnedRarity: !!(customization.ignoreOwnedRarity && context.collectionNames),
    collectionStrategy: customization.collectionStrategy ?? 'full',
    collectionOwnedPercent: customization.collectionOwnedPercent ?? 75,
    comboCountSetting: customization.comboCount ?? 0,
    selectedThemesWithSlugs:
      context.selectedThemes?.filter((t) => t.isSelected && t.source === 'edhrec' && t.slug) || [],
  };

  return {
    context,
    cfg,
    usedNames: new Set<string>(),
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: [],
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    currentSubtypeCounts: {},
    staticComboBoosts: new Map<string, number>(),
    comboCardNames: new Set<string>(),
    comboCards: new Map<string, Set<string>>(),
    gameChangerCount: { value: 0 },
    mustIncludeNames: [],
    mustIncludeSources: new Map<string, 'user' | 'deck' | 'combo'>(),
    saltIndex: new Map<string, number>(),

    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: null,
    dataSource: 'scryfall',
    baseData: null,
    themeOverlapCounts: new Map<string, number>(),
    roleTargets: null,
    roleTargetBreakdown: undefined,
    detectedArchetype: undefined,
    resolvedPacing: 'balanced',
    detectedPacing: 'balanced',
    swapCandidates: undefined,
    detectedCombos: undefined,
    gapAnalysis: undefined,
    deckScore: undefined,
    cardInclusionMap: undefined,
    cardRelevancyMap: undefined,
    stats: undefined,
    representativeStats: undefined,
    usedThemes: undefined,
  };
}

// --- Shared closures, promoted to free functions taking `state` first. ---
// Bodies are verbatim from generateDeck with the closed-over containers
// rewritten to `state.X`.

// Mark a card name as used, including front-face name for DFCs.
// EDHREC uses front-face-only names while Scryfall uses "Front // Back".
export function markUsed(state: GenerationState, name: string): void {
  state.usedNames.add(name);
  if (name.includes(' // ')) {
    state.usedNames.add(frontFaceName(name));
  }
}

// Ban a card name, including front-face name for DFCs.
export function markBanned(state: GenerationState, name: string): void {
  state.bannedCards.add(name);
  if (name.includes(' // ')) {
    state.bannedCards.add(frontFaceName(name));
  }
}

export function addMustInclude(
  state: GenerationState,
  name: string,
  source: 'user' | 'deck' | 'combo'
): void {
  if (
    !state.bannedCards.has(name) &&
    !state.usedNames.has(name) &&
    !state.mustIncludeNames.includes(name)
  ) {
    state.mustIncludeNames.push(name);
    state.mustIncludeSources.set(name, source);
  }
}

// Dynamic combo boosts: recalculated each phase to boost remaining pieces of
// partially-assembled combos.
export function getComboBoosts(state: GenerationState): Map<string, number> {
  const boosts = new Map(state.staticComboBoosts);
  if (state.cfg.comboCountSetting <= 0 || state.comboCards.size === 0) return boosts;
  for (const [, cardSet] of state.comboCards) {
    const totalPieces = cardSet.size;
    if (totalPieces <= 1) continue;
    let selectedCount = 0;
    for (const name of cardSet) {
      if (state.usedNames.has(name)) selectedCount++;
    }
    if (selectedCount === 0) continue;
    // completionFraction uses totalPieces-1 so 2-of-3 = 1.0 (max urgency for last piece)
    const completionFraction = selectedCount / (totalPieces - 1);
    const dynamicBoost = 50 * state.cfg.comboCountSetting * completionFraction;
    for (const name of cardSet) {
      if (state.usedNames.has(name)) continue;
      boosts.set(name, (boosts.get(name) ?? 0) + dynamicBoost);
    }
  }
  return boosts;
}

export function countAllCards(state: GenerationState): number {
  return Object.values(state.categories).flat().length;
}

// Re-export GeneratedDeck so phase modules that build/return it have one import site.
export type { GeneratedDeck };
