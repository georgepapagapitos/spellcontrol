import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';

/**
 * A token (or emblem) a card can create, derived from Scryfall's `all_parts`
 * relationship array. Carried through the offline slim payload so the deck
 * Stats tab can build a physical-token prep checklist. Just the name + the
 * Scryfall token type line.
 */
export interface CardToken {
  name: string;
  typeLine?: string;
}

// Scryfall Card type
export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  flavor_text?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  produced_mana?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  rarity: string;
  layout?: string; // Scryfall layout: "normal", "modal_dfc", "transform", etc.
  set: string;
  set_name: string;
  collector_number?: string;
  edhrec_rank?: number;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line: string;
    oracle_text?: string;
    flavor_text?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    loyalty?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      art_crop?: string;
    };
  }>;
  prices: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
    tix?: string | null;
  };
  legalities: {
    commander: string;
    [format: string]: string;
  };
  finishes?: string[];
  frame_effects?: string[];
  full_art?: boolean;
  border_color?: string;
  promo_types?: string[];
  games?: string[]; // Platforms: "paper", "arena", "mtgo"
  /**
   * Scryfall's related-card array (tokens, meld parts, combo pieces). Present on
   * cards resolved from the live Scryfall API (web). The offline slim bundle
   * drops it in favor of the pre-distilled `tokens` field below.
   */
  all_parts?: Array<{ component?: string; name?: string; type_line?: string }>;
  tokens?: CardToken[]; // Tokens/emblems this card creates, pre-distilled (offline bundle)
  // Added during deck generation
  isGameChanger?: boolean;
  isThemeSynergyCard?: boolean; // true if from EDHREC highsynergycards/topcards/gamechangers
  isMustInclude?: boolean;
  mustIncludeSource?: 'user' | 'deck' | 'combo'; // Where the must-include came from
  deckRole?: string; // Functional role detected by tagger/oracle text (e.g., 'ramp', 'removal')
  multiRole?: boolean; // True if card matches multiple role categories
  rampSubtype?: 'mana-producer' | 'mana-rock' | 'cost-reducer' | 'ramp';
  removalSubtype?: 'counterspell' | 'bounce' | 'spot-removal' | 'removal';
  boardwipeSubtype?: 'bounce-wipe' | 'boardwipe';
  cardDrawSubtype?: 'tutor' | 'wheel' | 'cantrip' | 'card-draw' | 'card-advantage';
  isMdfcLand?: boolean; // True if this is an MDFC with a land back face
  isChannelLand?: boolean; // True if this is a Kamigawa channel land
  isUtilityLand?: boolean; // True if this land has meaningful non-mana abilities (from otag:utility-land)
  isTapland?: boolean; // True if this land enters the battlefield tapped (from otag:tapland)
}

export interface ScryfallSearchResponse {
  object: 'list';
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

// Archetype definitions
export enum Archetype {
  AGGRO = 'aggro',
  CONTROL = 'control',
  COMBO = 'combo',
  MIDRANGE = 'midrange',
  VOLTRON = 'voltron',
  SPELLSLINGER = 'spellslinger',
  TOKENS = 'tokens',
  ARISTOCRATS = 'aristocrats',
  REANIMATOR = 'reanimator',
  TRIBAL = 'tribal',
  LANDFALL = 'landfall',
  ARTIFACTS = 'artifacts',
  ENCHANTRESS = 'enchantress',
  STORM = 'storm',
  GOODSTUFF = 'goodstuff',
}

// EDHREC Theme types
export interface EDHRECTheme {
  name: string;
  slug: string; // URL slug for theme-specific endpoint (e.g., "plus-1-plus-1-counters")
  count: number;
  url: string;
  popularityPercent?: number;
}

// EDHREC Card data (from cardlists)
export interface EDHRECCard {
  name: string;
  sanitized: string;
  primary_type: string;
  inclusion: number; // Percentage of decks that include this card
  num_decks: number; // Number of decks with this card
  synergy?: number; // Synergy score (-1 to 1)
  // Track if this card came from a high-priority synergy list
  isThemeSynergyCard?: boolean; // true if from highsynergycards, topcards, gamechangers
  isNewCard?: boolean; // true if from the newcards list (gets a small relevancy boost)
  isGameChanger?: boolean; // true if from the gamechangers list specifically
  prices?: {
    tcgplayer?: { price: number };
    cardkingdom?: { price: number };
  };
  image_uris?: Array<{
    normal: string;
    art_crop?: string;
  }>;
  color_identity?: string[];
  cmc?: number;
  salt?: number;
}

// A card-page "lift" co-play entry — how strongly a card is played alongside
// a given seed card, derived from EDHREC's per-card page (highliftcards /
// topcards). See services/edhrec/client.ts (parseCardLiftPool) for the
// derivation and services/deckBuilder/liftSynergy.ts for how it's scored.
export interface LiftEntry {
  name: string;
  lift: number;
  coPlayPct: number; // integer 0-100, derived inclusion/potential_decks
  numDecks: number;
  potentialDecks: number;
  lowSample: boolean; // numDecks < 50 (strict floor)
}

// EDHREC Commander statistics
export interface EDHRECCommanderStats {
  avgPrice: number;
  numDecks: number;
  deckSize: number; // Non-commander deck size from EDHREC (typically ~81)
  manaCurve: Record<number, number>; // CMC -> count (e.g., { 1: 10, 2: 12, 3: 20, ... })
  typeDistribution: {
    creature: number;
    instant: number;
    sorcery: number;
    artifact: number;
    enchantment: number;
    land: number;
    planeswalker: number;
    battle: number;
  };
  landDistribution: {
    basic: number;
    nonbasic: number;
    total: number;
  };
}

// EDHREC Top Commander (from commanders page)
export interface EDHRECTopCommander {
  rank: number;
  name: string;
  sanitized: string;
  colorIdentity: string[];
  numDecks: number;
}

// EDHREC Similar Commander
export interface EDHRECSimilarCommander {
  name: string;
  sanitized: string;
  colorIdentity: string[];
  cmc: number;
  imageUrl?: string;
  url: string;
}

// Full EDHREC Commander data
export interface EDHRECCommanderData {
  themes: EDHRECTheme[];
  stats: EDHRECCommanderStats;
  cardlists: {
    creatures: EDHRECCard[];
    instants: EDHRECCard[];
    sorceries: EDHRECCard[];
    artifacts: EDHRECCard[];
    enchantments: EDHRECCard[];
    planeswalkers: EDHRECCard[];
    lands: EDHRECCard[];
    // All non-land cards combined
    allNonLand: EDHRECCard[];
  };
  similarCommanders: EDHRECSimilarCommander[];
}

export interface ThemeResult {
  name: string;
  source: 'edhrec' | 'local';
  slug?: string; // URL slug for EDHREC theme-specific endpoint
  deckCount?: number;
  popularityPercent?: number;
  archetype?: Archetype;
  score?: number;
  confidence?: 'high' | 'medium' | 'low';
  isSelected: boolean;
}

// Deck composition
export type DeckCategory =
  | 'lands'
  | 'ramp'
  | 'cardDraw'
  | 'singleRemoval'
  | 'boardWipes'
  | 'creatures'
  | 'synergy'
  | 'utility';

export interface DeckComposition {
  lands: number;
  ramp: number;
  cardDraw: number;
  singleRemoval: number;
  boardWipes: number;
  creatures: number;
  synergy: number;
  utility: number;
}

// EDHREC Combo types
export interface EDHRECCombo {
  comboId: string;
  cards: { name: string; id: string }[];
  results: string[];
  deckCount: number;
  rank: number;
  bracket: number | null;
  bracketTag?: string | null;
  prereqCount: number;
  cardCount: number;
  /** EDHREC combo-page path (e.g. "/combos/golgari/250-779"), or null. */
  href: string | null;
}

export interface DetectedCombo {
  comboId: string;
  cards: string[];
  results: string[];
  isComplete: boolean;
  missingCards: string[];
  deckCount: number;
  bracket: number | null;
  bracketTag?: string | null;
  cardCount: number;
}

export interface GapAnalysisCard {
  name: string;
  price: string | null;
  inclusion: number;
  synergy: number;
  typeLine: string;
  cmc?: number; // Mana value — used for early ramp CMC multiplier in scoring
  imageUrl?: string;
  isOwned?: boolean;
  role?: string; // Functional role from tagger (e.g. 'ramp', 'removal')
  roleLabel?: string; // Display label (e.g. 'Ramp', 'Card Draw')
}

/**
 * A generation-time "hidden synergy" suggestion surfaced from EDHREC card-page
 * lift data (see services/deckBuilder/deckGeneration/phaseLiftPicks.ts) — a
 * package pick the generator did NOT add to the deck, only proposed. `kind`
 * distinguishes a single strong co-play pairing ('bomb') from a candidate
 * lifted by several deck cards at once ('cluster'); `liftedBy` names the
 * seed(s) responsible, capped to 3, strongest first.
 */
export interface LiftPackagePick {
  name: string;
  kind: 'bomb' | 'cluster';
  liftedBy: string[];
  lowSample: boolean;
  owned: boolean;
}

/** Describes which data source was ultimately used for deck generation */
export type DeckDataSource =
  | 'theme+bracket' // Ideal: theme-specific data with bracket/power level
  | 'theme' // Theme data but without bracket filtering
  | 'base+bracket' // Base commander data with bracket/power level
  | 'base' // Base commander data, no bracket
  | 'scryfall' // No EDHREC data at all — pure Scryfall search
  | 'oracle-role' // Alternative generator: pool built from Scryfall oracle (function) tags
  | 'art-theme' // Alternative generator: pool filtered to a single art motif (arttag:)
  | 'historical'; // Alternative generator: pool limited to cards printed on/before a year

/**
 * Alternative deck-generation strategies. `edhrec` (default) sources the card
 * pool from EDHREC's per-commander recommendation lists; the others synthesize
 * the pool from deterministic Scryfall searches instead — leaning into card
 * function (oracle tags), illustration (art tags), or print date. All reuse the
 * same downstream picking/curve/role/combo/analytics pipeline.
 */
export type GenerationMode = 'edhrec' | 'oracle-role' | 'art-theme' | 'historical';

/**
 * Compact, persisted record of how a generated deck measured up to its build
 * intent — surfaced as the post-generation "build report" (fill + flag). Only
 * set on generated decks; assembled from the in-memory GeneratedDeck at save
 * time, since most of its inputs (dataSource, shortfalls, roleTargets) are not
 * otherwise persisted.
 */
export interface BuildReport {
  /** What the user aimed for (EDHREC pool filter). */
  targetBracket: TargetBracket | 'all';
  /** Bracket the finished list actually estimated to, at generation time. */
  estimatedBracket: number;
  /** Which EDHREC pool we ended up using (reveals silent fallbacks). */
  dataSource: DeckDataSource;
  /** Which generation strategy the user chose (defaults to 'edhrec'). */
  generationMode?: GenerationMode;
  /** Mode-specific descriptor for the report (art motif slug, or print-year ceiling). */
  generationModeDetail?: string;
  /** Optional note about how the mode resolved (e.g. historical eased its year). */
  generationNote?: string;
  builtFromCollection: boolean;
  collectionStrategy?: CollectionStrategy;
  /** % of the mainboard that came from the user's collection. */
  ownedPercentActual?: number;
  /** Requested owned-% target (partial mode only). */
  ownedPercentTarget?: number;
  /** Basic lands added as last-resort filler (collection + filter shortfall). */
  basicsPadded?: number;
  /** Cards added from outside the collection to complete an owned-only build
   *  (the collection was exhausted before the deck was full). */
  collectionRelaxed?: number;
  /** "Wanted X → used your Y" substitutions: closest owned cards swapped in for
   *  unowned staples to keep an owned-only deck inside the collection. */
  collectionSubstitutions?: SubstituteRow[];
  /** Cards in the deck that EDHREC has no inclusion data for (chosen by the
   *  fallback fill, not the EDHREC pool). `matchedTags` are the deck-synergy tags
   *  they share with the rest of the deck — empty means a pure slot-filler.
   *  Owned/collection builds only; explains the "why is this 0%-card here" cards. */
  synergyFills?: Array<{ name: string; matchedTags: string[] }>;
  /** Per-role "wanted N, got M" gaps where the deck fell short of target. */
  roleGaps?: Array<{ role: string; have: number; want: number }>;
  /** Cards that are owned but all copies are committed to other decks. */
  claimedConflicts?: number;
  /** "Hidden synergy" suggestions from EDHREC lift data — never added to the
   *  deck, surfaced only in the build report. See LiftPackagePick. */
  packagePicks?: LiftPackagePick[];
  /** Disclosure note: how many higher-lift candidates the hard filters
   *  removed, and the dominant reason. Undefined when nothing was filtered. */
  liftPicksNote?: string;
}

export interface GeneratedDeck {
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  categories: Record<DeckCategory, ScryfallCard[]>;
  stats: DeckStats;
  usedThemes?: string[];
  gapAnalysis?: GapAnalysisCard[];
  /** "Hidden synergy" suggestions from EDHREC lift data — never added to the
   *  deck, surfaced only in the build report. See LiftPackagePick. */
  packagePicks?: LiftPackagePick[];
  /** Disclosure note: how many higher-lift candidates the hard filters
   *  (color identity/legality/rarity/budget/etc.) removed, and the dominant
   *  reason. Undefined when nothing was filtered. */
  liftPicksNote?: string;
  builtFromCollection?: boolean;
  collectionShortfall?: number;
  filterShortfall?: number; // Extra basic lands added because scryfallQuery filters reduced the available card pool
  /** Cards pulled from OUTSIDE the collection to complete an owned-constrained
   *  deck when the owned pool was exhausted — relaxation before basic padding. */
  collectionRelaxedCount?: number;
  /** "Wanted X → used your Y" substitutions: owned cards swapped in for unowned
   *  EDHREC staples to complete an owned-only deck from the collection. */
  collectionSubstitutions?: SubstituteRow[];
  detectedCombos?: DetectedCombo[];
  typeTargets?: Record<string, number>;
  dataSource?: DeckDataSource;
  roleCounts?: Record<string, number>; // Actual role counts when balanced roles mode was active
  roleTargets?: Record<string, number>; // Target role counts when balanced roles mode was active
  roleTargetBreakdown?: Record<string, RoleTargetBreakdown>; // Per-role derivation when balanced roles mode was active
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  swapCandidates?: Record<string, ScryfallCard[]>; // Keyed by RoleKey or 'type:{cardType}', top candidates per role/type for card swapping
  removedFromDeck?: string[]; // Cards from original deck that were cut during build-from-deck optimization
  deckScore?: number; // Sum of EDHREC inclusion % for all non-land cards
  cardInclusionMap?: Record<string, number>; // cardName → EDHREC inclusion %
  cardRelevancyMap?: Record<string, number>; // cardName → composite relevancy score (raw, 0-200+)
  detectedArchetype?: Archetype; // Archetype inferred from themes for dynamic role targeting
  detectedPacing?: Pacing; // Pacing estimated from EDHREC stats at generation time
  bracketEstimation?: import('@/deck-builder/services/deckBuilder/bracketEstimator').BracketEstimation;
  gameChangerNames?: string[]; // Cached for bracket re-estimation on swap (avoids async)
  deckGrade?: { letter: string; headline: string }; // Overall grade computed at end of generation
  generationMode?: GenerationMode; // Which generator built this deck (default 'edhrec')
  generationModeDetail?: string; // Mode-specific descriptor (art motif slug, or "year<=YYYY")
  generationRelaxedNote?: string; // e.g. historical mode eased its year ceiling to find a pool
}

export interface DeckStats {
  totalCards: number;
  averageCmc: number;
  manaCurve: Record<number, number>; // CMC -> count
  colorDistribution: Record<string, number>; // Color -> count
  typeDistribution: Record<string, number>; // Type -> count
  averageSalt?: number; // Mean EDHREC salt score across non-land cards with known salt
  saltiestCards?: Array<{ name: string; salt: number }>; // Top-N by salt, descending
}

// Deck edit history
export type DeckHistoryAction = 'add' | 'remove' | 'swap' | 'sideboard' | 'maybeboard';

export interface DeckHistoryEntry {
  id: string;
  action: DeckHistoryAction;
  cardName: string;
  targetCardName?: string;
  timestamp: number;
}

// Deck size (used by the generation engine for scaling)
export type DeckSize = number;

// MTG format that a deck is built for
export type DeckFormat =
  | 'commander'
  | 'brawl'
  | 'standard'
  | 'pauper'
  | 'modern'
  | 'pioneer'
  | 'legacy'
  | 'vintage';

export interface DeckFormatConfig {
  format: DeckFormat;
  label: string;
  description: string;
  deckSize: number;
  mainboardSize: number;
  sideboardSize: number;
  defaultLands: number;
  landRange: [number, number];
  hasCommander: boolean;
  isSingleton: boolean;
  maxCopies: number;
  legalityKey: string;
  supportsGeneration: boolean;
}

// EDHREC budget filter
export type BudgetOption = 'any' | 'budget' | 'expensive';

// Game changer limit: 'none' = 0, 'unlimited' = no cap, or a specific number
export type GameChangerLimit = 'none' | 'unlimited' | number;

/**
 * Target Bracket — the power-level tier the user is aiming for during
 * generation. Used as an EDHREC card-pool filter (selects the
 * exhibition/core/upgraded/optimized/cedh card list). This is build-time
 * intent and is distinct from the computed `BracketEstimation` (which
 * scores the resulting deck contents).
 */
export type TargetBracket = 'all' | 1 | 2 | 3 | 4 | 5;

// Max card rarity filter
export type MaxRarity = 'common' | 'uncommon' | 'rare' | 'mythic' | null;

// Salt level — discrete 0..3 slider. Uses EDHREC salt scores (vote-based
// "most-hated" data). 0=unsalted (strict filter), 1=low (moderate filter),
// 2=any (no filter, default), 3=extra (no filter + boost salty cards).
export type SaltTolerance = 0 | 1 | 2 | 3;

// 'full'/'available' hard-filter to owned cards; 'partial' is a percentage
// quota; 'prefer' is a soft owned-first ranking bias (best deck, leaning on
// your cards — no forced ratio, no hard filter). See cardPicking.ts.
export type CollectionStrategy = 'full' | 'partial' | 'available' | 'prefer';

// Ban list (preset or custom)
export interface BanList {
  id: string;
  name: string;
  cards: string[];
  isPreset: boolean;
  enabled: boolean;
}

// User-created reusable card list or deck
export interface UserCardList {
  id: string;
  type?: 'list' | 'deck';
  name: string;
  description: string;
  cards: string[];
  sideboard?: string[];
  maybeboard?: string[];
  commanderName?: string;
  partnerCommanderName?: string;
  deckSize?: number; // Total intended deck size including commander(s)
  primer?: string; // Strategy notes / deck primer (deck type only)
  generationSummary?: string; // "Built with: X · Bracket 3 · Budget" — cleared on first edit
  createdAt: number;
  updatedAt: number;
  // Cached display data (computed on save to avoid Scryfall fetches on browse)
  cachedTypeBreakdown?: Record<string, number>;
  cachedColorIdentity?: string[];
  cachedCommanderArtUrl?: string;
}

// Reference to a user list applied as exclude or include
export interface AppliedList {
  listId: string;
  enabled: boolean;
}

export type Pacing = 'aggressive-early' | 'fast-tempo' | 'balanced' | 'midrange' | 'late-game';

// Per-role breakdown of how the final target count was derived.
// Used by the optimizer UI to show an "EDHREC-typical + archetype + pacing" tooltip.
export interface RoleTargetBreakdown {
  edhrecCount: number | null; // null when no EDHREC data was passed in
  archetypeTarget: number; // base × archetype multiplier (before blend, before pacing)
  pacingMultiplier: number; // pacing multiplier applied after the blend
  blended: number; // final target after blend + pacing + clamp
}

// Advanced deck framework targets — null fields mean "use EDHREC/fallback defaults"
export interface AdvancedTargets {
  curvePercentages: Record<number, number> | null; // CMC bucket → percentage of non-land cards
  typePercentages: Record<string, number> | null; // card type → percentage of non-land cards
  roleTargets: Record<string, number> | null; // role → absolute count target (still wins outright when set)
  edhrecBlendWeight: number | null; // 0..1, null = default (0.6). 0 = archetype only, 1 = EDHREC only.
  edhrecInclusionThreshold: number | null; // percent, null = default (25). Dev-only tuning knob.
}

// User customization
export interface Customization {
  deckFormat: DeckSize;
  landCount: number;
  nonBasicLandCount: number; // How many non-basic lands to include (rest will be basics)
  bannedCards: string[]; // Card names to exclude from deck generation
  banLists: BanList[]; // Named ban lists (preset + custom)
  mustIncludeCards: string[]; // Card names to force-include in deck generation (first priority)
  tempBannedCards: string[]; // Temporary bans from deck toolbar (cleared on generation)
  tempMustIncludeCards: string[]; // Temporary must-includes from combo section (cleared on generation)
  maxCardPrice: number | null; // Max USD price per card, null = no limit
  deckBudget: number | null; // Total deck budget in USD, null = no limit
  budgetOption: BudgetOption; // EDHREC card pool: any (normal), budget, or expensive
  gameChangerLimit: GameChangerLimit; // How many game changer cards to allow
  targetBracket: TargetBracket; // Build-time power-level target (EDHREC card-pool filter)
  maxRarity: MaxRarity; // Max card rarity, null = no limit
  tinyLeaders: boolean; // Restrict all non-land cards to CMC <= 3
  collectionMode: boolean; // When true, constrain generation to owned cards
  collectionStrategy: CollectionStrategy; // 'full' = only owned cards, 'partial' = prioritize owned then fill with recommended
  collectionOwnedPercent: number; // 25-100, target % of non-land cards from collection in partial mode
  arenaOnly: boolean; // When true, only use cards available on MTG Arena
  scryfallQuery: string; // Additional Scryfall search syntax appended to all card queries (e.g. "set:mkm", "is:full-art")
  comboCount: number; // 0 = none, 1 = normal, 2 = a few extra, 3 = many combo pieces prioritized
  hyperFocus: boolean; // When true, boost unique theme cards and penalize generic multi-theme cards
  balancedRoles: boolean; // When true, boost cards that fill underrepresented functional roles (ramp, removal, etc.)
  ignoreOwnedBudget: boolean; // When true, owned cards don't count against budget limits
  ignoreOwnedRarity: boolean; // When true, owned cards skip max-rarity restriction
  currency: 'USD' | 'EUR'; // Price currency for budget filtering and display
  appliedExcludeLists: AppliedList[]; // User lists toggled on as exclude lists
  appliedIncludeLists: AppliedList[]; // User lists toggled on as must-include lists
  advancedTargets: AdvancedTargets; // Advanced framework overrides (null = use defaults)
  tempoAutoDetect: boolean;
  tempoPacing: Pacing;
  saltTolerance: SaltTolerance;
  // ── Alternative generators (Scryfall-driven) ──
  generationMode: GenerationMode; // 'edhrec' = default EDHREC pipeline; others synthesize the pool from Scryfall
  artThemeTag: string; // arttag: slug for 'art-theme' mode (e.g. 'dragon'); '' until chosen
  historicalYear: number; // print-year ceiling for 'historical' mode (cards printed on/before this year)
  permanentsOnly: boolean; // 'oracle-role' toggle: restrict the nonland pool to permanents (dodges counterspells)
}

// Store state
export interface AppState {
  // Commander
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];

  // EDHREC Themes
  edhrecThemes: EDHRECTheme[];
  selectedThemes: ThemeResult[];
  themesLoading: boolean;
  themesError: string | null;
  themeSource: 'edhrec' | 'local';
  edhrecNumDecks: number | null;

  // EDHREC land suggestion (set when commander data is fetched)
  edhrecLandSuggestion: { landCount: number; nonBasicLandCount: number } | null;
  // Full EDHREC stats for seeding advanced customization defaults
  edhrecStats: EDHRECCommanderStats | null;
  // True when the user has manually adjusted land count (prevents EDHREC from overriding)
  userEditedLands: boolean;

  // Customization
  customization: Customization;

  // Deck
  generatedDeck: GeneratedDeck | null;
  deckHistory: DeckHistoryEntry[];

  // UI
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;

  // Actions
  setCommander: (card: ScryfallCard | null) => void;
  setPartnerCommander: (card: ScryfallCard | null) => void;
  setEdhrecThemes: (themes: EDHRECTheme[]) => void;
  setEdhrecNumDecks: (count: number | null) => void;
  setSelectedThemes: (themes: ThemeResult[]) => void;
  toggleThemeSelection: (themeName: string) => void;
  setThemesLoading: (loading: boolean) => void;
  setThemesError: (error: string | null) => void;
  setEdhrecLandSuggestion: (
    suggestion: { landCount: number; nonBasicLandCount: number } | null
  ) => void;
  setEdhrecStats: (stats: EDHRECCommanderStats | null) => void;
  setUserEditedLands: (edited: boolean) => void;
  updateCustomization: (updates: Partial<Customization>) => void;
  setGeneratedDeck: (deck: GeneratedDeck | null) => void;
  swapDeckCard: (oldCard: ScryfallCard, newCard: ScryfallCard) => void;
  pushDeckHistory: (entry: Omit<DeckHistoryEntry, 'id' | 'timestamp'>) => void;
  clearDeckHistory: () => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
