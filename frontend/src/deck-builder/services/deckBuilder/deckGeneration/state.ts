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
  LiftEntry,
} from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import type { SubstituteCandidate } from '@/deck-builder/services/deckBuilder/substituteFinder';
import { parseSetFromQuery } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';
import type { BasicPrintingAvail } from '@/lib/collection-availability';

export interface GenerationContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  customization: Customization;
  selectedThemes?: ThemeResult[];
  collectionNames?: Set<string>;
  collectionAvailableCounts?: Map<string, number>;
  /**
   * Per-printing breakdown of free owned basic lands (name → printings sorted
   * by owned count). Lets land generation pull real groups of the player's
   * basics across their owned printings instead of N of one default printing.
   */
  collectionBasicPrintings?: Map<string, BasicPrintingAvail[]>;
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
  /** MTG format ('commander' default). 'paupercommander' gates every pick on
   *  PDH legality and routes pool sourcing to the Scryfall alt-pool builder. */
  mtgFormat: NonNullable<Customization['mtgFormat']>;
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
  /** Staples <-> Brew dial (0..1, 0.5 default/no-op) — see cardPicking.ts's
   *  calculateCardPriority for the multiplier math it drives. */
  brewLevel: number;
  /** Game Changer headroom for violatesUserCaps (deckFilters.ts). Wired to
   *  this state in createState, so they read the deck as it stands: repair
   *  phases swap cards long after the pick-time running tally was taken. */
  isGameChanger?: (name: string) => boolean;
  gameChangerLimitReached?: () => boolean;
  /** E403: partial mode's owned share, kept. True for an owned card while the
   *  deck's owned nonland count is at or below the requested share, so a
   *  phase that swaps for quality (combo audit, coherence repair, flagship
   *  seating, role-surplus conversion) cuts an unowned card instead of
   *  undoing the quota. Budget and bracket convergence ignore it: those
   *  enforce limits the player set. Wired in createState like the Game
   *  Changer headroom above. */
  ownedQuotaProtects?: (name: string) => boolean;
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
  /** User/deck must-includes addMustInclude silently no-opped because the same
   *  name is also on the ban list — surfaced by the caller (deckGenerator.ts)
   *  through the same skip-note channel as every other dropped forced pick, so
   *  a must-include+ban conflict never vanishes without explanation. Combo-
   *  sourced picks aren't pushed here (their skips are by design). */
  mustIncludeBanConflicts: string[];
  saltIndex: Map<string, number>;
  /** EDHREC card-page lift pools fetched so far this generation, keyed by
   *  seed name — shared across every re-rank/tie-break insertion point (see
   *  deckGeneration/liftPools.ts). Non-empty pools only. */
  liftSeedPools: Map<string, LiftEntry[]>;
  /** Seed names already attempted (success or failure) — so a failed fetch
   *  isn't retried, and the MAX_LIFT_SEEDS cap counts attempts, not hits. */
  liftSeedsTried: Set<string>;
  /** Memoization cache for liftPools.ts:getLiftIndex — invalidated whenever
   *  liftSeedPools.size changes. */
  liftIndexCache?: {
    size: number;
    index: Map<string, { clusterScore: number; liftedBy: string[] }>;
  };

  // --- Mid-life "result" locals (assigned by one phase, read later) ---
  gameChangerNames: Set<string>;
  combos: EDHRECCombo[];
  edhrecData: EDHRECCommanderData | null;
  dataSource: DeckDataSource;
  /** E93 disclosure: set when a bracket-narrowed EDHREC page was too thin and
   *  generation laddered down to a broader page. Undefined otherwise. */
  bracketPoolFallbackNote: string | undefined;
  /** E221: names the blend injected into the POOL. Narrowed to the cards that
   *  actually shipped (summarizeSeatedBlend) before it reaches the build report
   *  and the misfit pass. Empty when the flag is off or nothing was injected. */
  archetypeBlendNames: string[];
  /** E221: the theme whose tag page was blended in, for the disclosure. */
  archetypeBlendTheme: string | undefined;
  /** E282: owned cards injected into the pool from similar commanders' pages
   *  (owned-only builds), and the commanders they came from. Pool-level; the
   *  generator narrows to what shipped before it reaches the report. */
  similarPoolNames: string[];
  similarPoolCommanders: string[];
  /** Why the widening ran: how few of the commander page's cards the user owns. */
  similarPoolOwnedOnPage: number | undefined;
  themeOverlapCounts: Map<string, number>;
  roleTargets: Record<RoleKey, number> | null;
  roleTargetBreakdown: Record<RoleKey, RoleTargetBreakdown> | undefined;
  detectedArchetype: Archetype | undefined;
  resolvedPacing: Pacing;
  detectedPacing: Pacing;
  swapCandidates: Record<string, ScryfallCard[]> | undefined;
  detectedCombos: DetectedCombo[] | undefined;
  /** Emergent combo-completion disclosure: combo completeness snapshot taken
   *  right after must-includes are seeded (before the main picking loop) —
   *  isolates combos the user's must-includes already completed from combos
   *  the algorithm's own subsequent picks go on to complete. Undefined until
   *  that snapshot runs; never reassigned after. */
  baselineDetectedCombos?: DetectedCombo[];
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
    mtgFormat: customization.mtgFormat ?? 'commander',
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
    // Clamped to [0,1]: cardPicking.ts's calculateCardPriority multiplier goes
    // negative past 1.5, inverting the staples<->brew dial instead of just
    // maxing it out.
    brewLevel: Math.min(1, Math.max(0, customization.brewLevel ?? 0.5)),
  };

  const state: GenerationState = {
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
    mustIncludeBanConflicts: [],
    saltIndex: new Map<string, number>(),
    liftSeedPools: new Map<string, LiftEntry[]>(),
    liftSeedsTried: new Set<string>(),

    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: null,
    dataSource: 'scryfall',
    bracketPoolFallbackNote: undefined,
    archetypeBlendNames: [],
    archetypeBlendTheme: undefined,
    similarPoolNames: [],
    similarPoolCommanders: [],
    similarPoolOwnedOnPage: undefined,
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
  cfg.isGameChanger = (name) => state.gameChangerNames.has(name);
  cfg.gameChangerLimitReached = () =>
    cfg.maxGameChangers !== Infinity &&
    Object.values(state.categories).reduce(
      (n, cards) => n + cards.filter((c) => state.gameChangerNames.has(c.name)).length,
      0
    ) >= cfg.maxGameChangers;
  cfg.ownedQuotaProtects = (name) => {
    const owned = state.context.collectionNames;
    if (cfg.collectionStrategy !== 'partial' || !owned?.has(name)) return false;
    const nonLand = Object.entries(state.categories)
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);
    const ownedCount = nonLand.filter((c) => owned.has(c.name)).length;
    return ownedCount <= Math.round((nonLand.length * cfg.collectionOwnedPercent) / 100);
  };
  return state;
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
  if (state.bannedCards.has(name)) {
    // A user/deck pick that's also banned used to just vanish (LIVE-CONFIRMED:
    // Lathril + "Elvish Archdruid" in both lists shipped neither the card nor
    // any note) — record it so the caller can route it through the same
    // skip-note channel as every other dropped forced pick. Combo-sourced
    // picks stay silent (their skips are by design).
    if (source === 'user' || source === 'deck') state.mustIncludeBanConflicts.push(name);
    return;
  }
  if (!state.usedNames.has(name) && !state.mustIncludeNames.includes(name)) {
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
