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
  /** Force-included staple mana rock (Sol Ring / Arcane Signet, see
   *  phaseStapleManaRocks.ts) — provenance ONLY, protects it from Smart Trim's
   *  role-surplus penalty. Distinct from isMustInclude (a USER lock), which
   *  several surfaces (nonbo.ts, coherenceAudit.ts, buildReport.ts) read as
   *  "don't second-guess this pick" — conflating the two would corrupt those. */
  isStapleRock?: boolean;
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
  TEMPO = 'tempo',
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

/**
 * Which precedence tier decided a deck's `detectedArchetype` (see
 * `inferArchetypeProvenance` in roleTargets.ts) — persisted so the report/UI
 * layer can explain the archetype label instead of just asserting it:
 * - 'user-theme': the user's first selected theme resolved to a real archetype.
 * - 'edhrec-dominant': EDHREC's own ranked commander-page themes had a clear
 *   plurality strategy (see DOMINANT_THEME_SHARE).
 * - 'neutral': EDHREC theme data exists but no theme dominates — GOODSTUFF.
 * - 'oracle-text': no EDHREC theme data at all; fell back to the
 *   commander-profile oracle-text keyword vote.
 */
export type ArchetypeProvenance = 'user-theme' | 'edhrec-dominant' | 'neutral' | 'oracle-text';

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

/**
 * Combo-upside price disclosure (combo-boost price-sanity exemption made
 * visible): an expensive card the price-sanity tie-break let win over a
 * cheaper same-role staple because it carries a live combo-assembly boost —
 * disclosed only while the combo it belongs to hasn't actually completed,
 * and only when a genuinely cheaper same-role alternative was passed over
 * (see deckGenerator.ts's buildComboUpsideNotes).
 */
export interface ComboUpsideNote {
  name: string;
  /** Pre-formatted display price (e.g. "$472"), currency-aware. */
  price: string;
  /** The combo's produces text (DetectedCombo.results), joined for display. */
  produces: string;
  /** Still-missing piece(s) of the nearest-to-complete combo this card belongs to. */
  missingCards: string[];
  ownedPieces: number;
  totalPieces: number;
  /** Cheapest same-role, higher-or-equal-inclusion alternative that was passed over. */
  comparedName: string;
  /** Pre-formatted display price for comparedName. */
  comparedPrice: string;
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
  /** EDHREC lift co-play seed names (top-3, strongest first) this candidate is
   *  connected to — see services/deckBuilder/liftSynergy.ts buildLiftIndex.
   *  Undefined when the card has no lift connectivity to the seed set. */
  liftedBy?: string[];
  /** Staples <-> Brew dial: true when this suggestion is a genuine non-staple
   *  backed by synergy or lift evidence AND the dial was leaned toward Brew
   *  when generated — see phaseGapAnalysis.ts. */
  brewFavored?: boolean;
}

/**
 * One evidence line behind a hidden-gem suggestion (E146). `names` carries the
 * concrete cards/engine the copy cites: lift → up to 3 seed names, similar →
 * the in-deck card it plays like, axis → the engine's display label.
 */
export interface HiddenGemSignal {
  kind: 'lift' | 'similar' | 'axis';
  names: string[];
}

/**
 * An underrated-card suggestion for the editor's Suggestions tab (E146): a
 * card EDHREC's inclusion ranking does NOT recommend for this commander (low
 * or no inclusion on its page, never overlapping gapAnalysis), vouched for by
 * at least one popularity-independent signal. Lean and persistable like
 * GapAnalysisCard — names + primitives only; ownership is marked by the UI
 * against the live collection. See services/deckBuilder/hiddenGems.ts.
 */
export interface HiddenGemRow {
  name: string;
  typeLine: string;
  price: string | null;
  cmc?: number;
  /** EDHREC inclusion % when the commander page lists the card (always below
   *  the engine's low-inclusion ceiling — that's what makes it hidden). */
  inclusion?: number;
  /** Evidence, strongest first (1–3 entries, one per signal kind). */
  signals: HiddenGemSignal[];
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

/** One color's line in the manabase self-explanation (see manabaseMath). */
export interface ManabaseColorLine {
  /** WUBRG letter. */
  color: string;
  /** Raw colored pips this color must pay in nonland costs. */
  pips: number;
  /** Sources in the final deck (lands + rocks/dorks) producing this color. */
  sources: number;
  /** Sources needed to clear the shortfall bar (ratio × pips, feasibility-capped
   *  across colors so per-color targets can't outrun the deck's actual mana
   *  sources). `short` is exactly `sources < target` — one baseline. */
  target: number;
  /** `sources < target` (same pacing-aware coverage bar as the editor panel's
   *  `isColorShort`) — the boolean and the note always agree by construction. */
  short: boolean;
}

/**
 * The generated deck's manabase self-explanation: per demanded color, the
 * sources actually built vs the castability-weighted target, computed over the
 * FINAL deck. Assembled by services/deckBuilder/manabaseMath.ts.
 */
export interface ManabaseSummary {
  /** Demanded colors only, WUBRG order. */
  lines: ManabaseColorLine[];
  totalLands: number;
  /** Nonland permanents counted as mana sources (rocks, dorks). */
  nonlandSources: number;
  /** Headline, e.g. "2 white sources short for costs at mana value ≤ 2". */
  note?: string;
}

/**
 * One generation-end coherence-audit finding (see coherenceAudit.ts): a card
 * the final deck may not support — a payoff whose engine never materialized
 * ('dead-payoff'), a card with no remaining tie to the deck at all
 * ('unjustified-slot'), a land the manabase can't back up ('land-sanity'), a
 * card opposing the deck's own plan ('nonbo') — or a deck-level note: a
 * lopsided engine, a missing/thin win path ('win-condition'), or a threat
 * class the deck's colors could answer but don't ('answer-coverage').
 */
export interface CoherenceFinding {
  kind:
    | 'dead-payoff'
    | 'unjustified-slot'
    | 'lopsided-engine'
    | 'land-sanity'
    | 'win-condition'
    | 'answer-coverage'
    | 'nonbo'
    | 'qualified-payoff';
  severity: 'warn' | 'info';
  /** Card the finding is about; absent for deck-level findings. */
  card?: string;
  message: string;
  /** For land-sanity findings the repair pass can execute: the WUBRG color
   *  whose basic land should replace the flagged land. Absent = report-only. */
  basicFixColor?: string;
  /** For zero-coverage answer-coverage warns the repair pass can execute: the
   *  threat class missing an answer. Absent = report-only. */
  answerClass?: 'creature' | 'artifact' | 'enchantment' | 'planeswalker';
}

/** One swap the bounded coherence-repair pass applied (T37 ethos: nothing
 *  moves silently — every auto-fix is disclosed in the build report). */
export interface CoherenceRepair {
  cut: string;
  added: string;
  reason: string;
}

/** Describes which data source was ultimately used for deck generation */
export type DeckDataSource =
  | 'theme+bracket' // Ideal: theme-specific data with bracket/power level
  | 'theme' // Theme data but without bracket filtering
  | 'base+bracket' // Base commander data with bracket/power level
  | 'base' // Base commander data, no bracket
  | 'scryfall' // No EDHREC data at all — pure Scryfall search
  | 'paupercommander' // PDH: function-faceted Scryfall pool constrained to f:paupercommander (EDHREC has no PDH data)
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
  /** The archetype generation actually used for role targets, auto land count,
   *  and the type floor — the single source of truth for "what archetype was
   *  this deck built as" (see project S3: single-sourcing the archetype
   *  label). Undefined only on reports assembled before this shipped. */
  archetype?: Archetype;
  /** Which precedence tier decided `archetype` (user theme pick, EDHREC
   *  dominant theme, neutral goodstuff, or the oracle-text keyword vote) —
   *  drives `archetypeNote`'s wording. */
  archetypeProvenance?: ArchetypeProvenance;
  /** Human-readable disclosure of the archetype and where it came from, e.g.
   *  "Built as Enchantress — from EDHREC's dominant theme for this
   *  commander." Includes a multi-theme addendum when more than one theme
   *  was selected (role targets only follow the first). */
  archetypeNote?: string;
  /** Which generation strategy the user chose (defaults to 'edhrec'). */
  generationMode?: GenerationMode;
  /** Mode-specific descriptor for the report (art motif slug, or print-year ceiling). */
  generationModeDetail?: string;
  /** Optional note about how the mode resolved (e.g. historical eased its year). */
  generationNote?: string;
  /** Disclosure when the archetype-aware auto land count adjusted the 37-land
   *  default (e.g. tribal/dork-dense decks running fewer). Undefined when the
   *  user set land count explicitly, or no adjustment applied. */
  landCountNote?: string;
  /** Disclosure when an explicit (user/deck) must-include couldn't be seated —
   *  off-color, over the rarity/CMC cap, not on Arena, or unresolvable. Names
   *  each dropped pick with its reason so a forced card never vanishes
   *  silently. Undefined when every explicit pick was included. */
  mustIncludeSkippedNote?: string;
  /** Disclosure when a combo-completion candidate (Combo Integrity Audit /
   *  combo floor) was skipped because it would exceed the deck budget.
   *  Undefined when no budget is set or nothing was skipped. */
  budgetNote?: string;
  /** Disclosure when the role-cap escape hatch admitted an over-cap card
   *  rather than shipping the deck short (a thin type pool left no
   *  under-cap alternative). Undefined when the cap was never breached. */
  roleCapOverflowNote?: string;
  /** Disclosure when the price-sanity tie-break (E80) actually flipped a same-role
   *  pick's winner toward the cheaper option at least once. Undefined when the
   *  tie-break never decided an outcome (off via budgetOption='expensive', or no
   *  qualifying pair ever arose). */
  priceSanityNote?: string;
  /** Disclosure (E110) when a casual-bracket ask (bracket <= 2) with no budget
   *  set still produced a high-total deck — bracket caps power, not price.
   *  Note-only; the total is unchanged. Undefined off the casual end, when a
   *  budget is set, or below the disclosure threshold. */
  bracketPriceDisclosureNote?: string;
  /** Disclosure when the deck's plan was board-centric (E109 — go-wide
   *  archetype, or a creature-heavy type target) and the wipe-asymmetry
   *  treatment actually did something: trimmed the board wipe target,
   *  preferred one-sided wipes at pick time, or both. Undefined when the
   *  plan wasn't board-centric. */
  wipeAsymmetryNote?: string;
  /** Disclosure when the E111 qualified-payoff pick-time gate's escape hatch
   *  seated a color/type-qualified ETB/death payoff the deck can't feed
   *  anyway (nothing else cleared every other gate to fill the slot).
   *  Undefined when the hatch never actually fired. */
  qualifiedPayoffGateNote?: string;
  /** Disclosure when the Combo Integrity Audit's auditAdd() bracket-ceiling
   *  backstop (E101) actually blocked a swap after its weak card was already
   *  evicted (E104). Undefined in the common case — the audit's own
   *  candidate-list pre-filters keep this from firing except on the rarer
   *  running-count race between candidates in the same audit pass. */
  comboAuditBracketBlockNote?: string;
  /** Disclosure when phaseLandSqueezeReconcile.ts (E88) cut cards to bring the
   *  deck back to size after the auto-tune raised land count past the
   *  37-land baseline. Undefined when the auto-tune never raised land count
   *  past baseline (the common case). */
  landSqueezeTrimNote?: string;
  /** Disclosure when the bracket-narrowed EDHREC page (bracket-only or
   *  theme+bracket) was too thin to build from (E93) and generation laddered
   *  down to a broader page — naming what was missing, what was used
   *  instead, and that the target bracket's card permissions were kept
   *  regardless. Undefined when no bracket was targeted, or the requested
   *  page had real data. */
  bracketPoolFallbackNote?: string;
  /** Expensive combo pieces the price-sanity tie-break let win over a cheaper
   *  same-role staple for a live-but-still-incomplete combo. Undefined when
   *  none arose, or every combo those cards belonged to went on to complete. */
  comboUpsideNotes?: ComboUpsideNote[];
  /** Disclosure when picks made during this build (curve/role/synergy fill,
   *  combo floor, coherence repair, …) completed a latent combo with cards
   *  already locked in — a diff of final detectedCombos completeness against
   *  a generation-start baseline. One entry per newly-completed combo.
   *  Undefined when nothing newly completed. */
  comboCompletionNotes?: string[];
  /** Generation-integrity disclosures (S1): a data source (tagger role data,
   *  combo data, the substitute-ranking index) failed to load even after a
   *  retry, so this build ran degraded on that axis without telling anyone.
   *  Rendered up top with warning styling. Undefined/empty when every source
   *  loaded fine. */
  integrityNotes?: string[];
  /** Disclosure when the Staples <-> Brew dial was off its 0.5 Balanced default —
   *  names which direction the user leaned so the report never leaves a
   *  reweighted pick pool unexplained. Undefined at the default. */
  brewDialNote?: string;
  /** Disclosure when a variety roll (varietySeed) shook up near-tie picks —
   *  names the roll number so the build is reproducible. Undefined for the
   *  default signature build. */
  varietyNote?: string;
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
  synergyFills?: Array<{ name: string; matchedTags: string[]; liftedBy?: string[] }>;
  /** Per-role "wanted N, got M" gaps where the deck fell short of target. */
  roleGaps?: Array<{ role: string; have: number; want: number }>;
  /** Roles significantly over target (>1.5x and >4 cards over), crowding out
   *  the rest of the deck (e.g. a bloated ramp bucket). Report-only. */
  roleExcesses?: Array<{ role: string; have: number; want: number }>;
  /** Cards that are owned but all copies are committed to other decks. */
  claimedConflicts?: number;
  /** Owned, identity-legal names "Available only" excluded from the pool
   *  because every copy is committed to another deck/cube (basics exempt —
   *  the land top-up supplies them regardless). Mirror of claimedConflicts;
   *  undefined when 0 or under other strategies. */
  committedExcluded?: number;
  /** "Hidden synergy" suggestions from EDHREC lift data — never added to the
   *  deck, surfaced only in the build report. See LiftPackagePick. */
  packagePicks?: LiftPackagePick[];
  /** Disclosure note: how many higher-lift candidates the hard filters
   *  removed, and the dominant reason. Undefined when nothing was filtered. */
  liftPicksNote?: string;
  /** Sources built vs castability-weighted targets per color (the manabase
   *  self-explanation). Undefined on decks generated before this shipped. */
  manabase?: ManabaseSummary;
  /** Generation-end coherence-audit findings (dead payoffs, unjustified slots,
   *  lopsided engines). Undefined when the audit found nothing. */
  coherenceFindings?: CoherenceFinding[];
  /** Swaps the bounded coherence-repair pass applied before the final audit.
   *  Undefined when nothing needed (or could be) repaired. */
  coherenceRepairs?: CoherenceRepair[];
  /** Swaps the budget-convergence pass applied to bring an over-budget deck
   *  in line (or as close as protections allow) — see phaseBudgetConverge.ts
   *  (E79). Undefined when no budget was set, or nothing needed swapping. */
  budgetRepairs?: CoherenceRepair[];
  /** Swaps the role-surplus rebalance pass applied — a reactive role
   *  (ramp/removal/boardwipe/cardDraw) running over its cap converted into a
   *  payoff pick — see phaseRoleSurplusRebalance.ts (E87). Undefined when no
   *  role ran over cap, or nothing cleared the improvement margin. */
  surplusConversions?: CoherenceRepair[];
  /** Reserved-slot seatings for a taxonomy's own flagship cards (E103) — a
   *  flat commanderWantsX visibility boost can't close a 20+ inclusion-point
   *  gap (Helm of the Host / Aggravated Assault on an Isshin build), so this
   *  displaces the single lowest-survival incumbent per seat instead. See
   *  phaseFlagshipSeating.ts. Undefined when the gate never fired or nothing
   *  cleared every pick-time gate. */
  flagshipSeatings?: CoherenceRepair[];
  /** Count of protection/free-interaction pieces (E87-new Slice A) — a
   *  parallel class, not one of the 4 tracked roles. Always set by
   *  assembleBuildReport (including 0 — the motivating gap is decks
   *  silently generating ZERO of these); optional only so decks saved
   *  before this shipped, or hand-built fixtures, don't need it. */
  protectionCount?: number;
  /** Disclosure note when protectionCount is 0 on an archetype where that's
   *  a real gap (Voltron for v1 — see PROTECTION_MOTIVATED_ARCHETYPES).
   *  Undefined otherwise. */
  protectionZeroNote?: string;
  /** Per-card "why is this here" provenance (S2) — card name → short human
   *  reason (EDHREC staple, theme fit, must-include, staple rock, combo
   *  floor, boost-driven pick, Scryfall shortfall fill, or a repair-phase
   *  swap reason). Lands are out of scope (land notes already exist).
   *  Undefined on decks generated before this shipped. */
  cardProvenance?: Record<string, string>;
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
  /** Lowercased card name -> top-3 lift seed names, for every deck card with
   *  EDHREC lift connectivity to this generation's seed pools. Lets the build
   *  report explain non-EDHREC fills without re-deriving the lift index. */
  liftedByMap?: Record<string, string[]>;
  /** Disclosure note: how many higher-lift candidates the hard filters
   *  (color identity/legality/rarity/budget/etc.) removed, and the dominant
   *  reason. Undefined when nothing was filtered. */
  liftPicksNote?: string;
  /** Sources built vs castability-weighted targets per color, computed over the
   *  final deck (the manabase self-explanation). */
  manabase?: ManabaseSummary;
  /** Generation-end coherence-audit findings over the final deck (see
   *  coherenceAudit.ts). Undefined when the audit found nothing. */
  coherenceFindings?: CoherenceFinding[];
  /** Swaps the bounded coherence-repair pass applied before the final audit. */
  coherenceRepairs?: CoherenceRepair[];
  /** Swaps the budget-convergence pass applied (E79). */
  budgetRepairs?: CoherenceRepair[];
  /** Swaps the role-surplus rebalance pass applied (E87). */
  surplusConversions?: CoherenceRepair[];
  /** Reserved-slot flagship seatings applied (E103). See BuildReport's field
   *  of the same name for the full rationale. */
  flagshipSeatings?: CoherenceRepair[];
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
  archetypeProvenance?: ArchetypeProvenance; // Which precedence tier decided detectedArchetype
  archetypeIsLowConfidence?: boolean; // True when detectedArchetype fell all the way to the oracle-text keyword vote (no EDHREC theme data, no user theme pick)
  detectedPacing?: Pacing; // Pacing estimated from EDHREC stats at generation time
  bracketEstimation?: import('@/deck-builder/services/deckBuilder/bracketEstimator').BracketEstimation;
  gameChangerNames?: string[]; // Cached for bracket re-estimation on swap (avoids async)
  deckGrade?: import('@/deck-builder/services/deckBuilder/commanderDeckAnalysis').DeckGrade; // Overall grade computed at end of generation
  generationMode?: GenerationMode; // Which generator built this deck (default 'edhrec')
  generationModeDetail?: string; // Mode-specific descriptor (art motif slug, or "year<=YYYY")
  generationRelaxedNote?: string; // e.g. historical mode eased its year ceiling to find a pool
  landCountNote?: string; // e.g. archetype-aware auto land count nudged the 37-land default
  mustIncludeSkippedNote?: string; // e.g. a forced pick was off-color / over a cap / not on Arena and couldn't be seated
  budgetNote?: string; // e.g. a combo upgrade was skipped to honor the budget cap
  roleCapOverflowNote?: string; // e.g. N cards kept over their role target to finish the deck (thin type pool)
  priceSanityNote?: string; // e.g. N cheaper near-equivalents preferred over premium picks (E80)
  bracketPriceDisclosureNote?: string; // e.g. casual-bracket ask + no budget still shipped a high total — bracket caps power, not price (E110)
  wipeAsymmetryNote?: string; // e.g. board-centric plan trimmed the wipe target and/or preferred one-sided wipes (E109)
  qualifiedPayoffGateNote?: string; // e.g. N qualified ETB/death payoffs seated anyway — nothing else cleared every gate (E111)
  comboAuditBracketBlockNote?: string; // e.g. N combo-audit swaps skipped to stay within the target bracket (E104)
  landSqueezeTrimNote?: string; // e.g. N cards cut to reconcile an auto-tuned land count raise (E88)
  bracketPoolFallbackNote?: string; // e.g. bracket-narrowed EDHREC page was too thin — laddered down to a broader page (E93)
  comboUpsideNotes?: ComboUpsideNote[]; // expensive combo pieces kept for still-incomplete-combo upside
  comboCompletionNotes?: string[]; // one per combo the build's own picks completed with cards already in the deck
  /** Generation-integrity disclosures (S1): a data source that couldn't be
   *  loaded (even after a retry) and so degraded this build silently unless
   *  flagged here — tagger role data, combo data, or the substitute-ranking
   *  index. Undefined/empty when every source loaded fine. */
  integrityNotes?: string[];
  /** Per-card "why is this here" provenance (S2) — see BuildReport's field of
   *  the same name for the full rationale. */
  cardProvenance?: Record<string, string>;
}

export interface DeckStats {
  totalCards: number;
  averageCmc: number;
  manaCurve: Record<number, number>; // CMC -> count
  colorDistribution: Record<string, number>; // Color -> count
  // Primary-type bucket (one bucket per card, checked creature-first) — an
  // "Enchantment Creature" (Sanctum Weaver, Heliod) counts once under
  // Creature here. See `enchantmentPermanentCount` for the true overlapping
  // total when a card's enchantment-ness matters on its own (E78 item 7).
  typeDistribution: Record<string, number>; // Type -> count
  // True count of every card with "Enchantment" anywhere in its type line,
  // including enchantment creatures/gods that `typeDistribution` buckets
  // under Creature — for enchantress-style "how many enchantments" reporting.
  enchantmentPermanentCount?: number;
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
  | 'paupercommander'
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

// User customization
export interface Customization {
  deckFormat: DeckSize;
  /**
   * MTG format the build targets. Only commander-family formats generate;
   * 'paupercommander' (PDH) routes sourcing to a Scryfall pool constrained to
   * `f:paupercommander` and gates every pick on that legality. Optional —
   * absent means 'commander' (all pre-existing builds).
   */
  mtgFormat?: DeckFormat;
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
  balancedRoles: boolean; // When true, boost cards that fill underrepresented functional roles (ramp, removal, etc.)
  // E80: price-sanity tie-break among comparable same-role candidates (see
  // cardPicking.ts's priceSanityTieBreak). This is a SMART DEFAULT, not a
  // plain boolean — the effective value (deckGenerator.ts's
  // `resolvePriceSanity`) is `priceSanity ?? (budgetOption !== 'expensive')`:
  // undefined defers to budgetOption (ON by default, OFF when the user
  // explicitly asked for premium/expensive picks), while an explicit
  // true/false always wins. No UI toggle yet — the live-eval harness can
  // still force either value via LIVE_GEN_PRICE_SANITY (deckGenerator.live.test.ts).
  priceSanity?: boolean;
  ignoreOwnedBudget: boolean; // When true, owned cards don't count against budget limits
  ignoreOwnedRarity: boolean; // When true, owned cards skip max-rarity restriction
  currency: 'USD' | 'EUR'; // Price currency for budget filtering and display
  appliedExcludeLists: AppliedList[]; // User lists toggled on as exclude lists
  appliedIncludeLists: AppliedList[]; // User lists toggled on as must-include lists
  tempoAutoDetect: boolean;
  tempoPacing: Pacing;
  saltTolerance: SaltTolerance;
  // ── Alternative generators (Scryfall-driven) ──
  generationMode: GenerationMode; // 'edhrec' = default EDHREC pipeline; others synthesize the pool from Scryfall
  artThemeTag: string; // arttag: slug for 'art-theme' mode (e.g. 'dragon'); '' until chosen
  historicalYear: number; // print-year ceiling for 'historical' mode (cards printed on/before this year)
  permanentsOnly: boolean; // 'oracle-role' toggle: restrict the nonland pool to permanents (dodges counterspells)
  // Staples <-> Brew dial: 0 = Staples (amplify EDHREC inclusion, damp synergy),
  // 0.5 = Balanced (default — a mathematical no-op, every multiplier below
  // evaluates to 1x so generation is byte-identical to the pre-dial formula),
  // 1 = Brew (damp inclusion, amplify synergy/theme-fit/hidden-synergy lift).
  // See cardPicking.ts's calculateCardPriority for the multiplier math.
  brewLevel: number;
  // Variety reroll: absent = the signature build (generation is byte-identical
  // for the same settings + data). Roll #N deterministically jitters near-tie
  // pick priorities — the same roll rebuilds the same deck, a new roll shakes
  // up close calls. See cardPicking.ts's computeVarietyJitterBoosts.
  varietySeed?: number;
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
