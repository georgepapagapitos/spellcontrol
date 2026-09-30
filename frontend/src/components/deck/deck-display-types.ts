import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import type {
  ScryfallCard,
  DeckCategory,
  DeckFormat,
  ThemeResult,
  BuildReport,
  Archetype,
} from '@/deck-builder/types';
import type { DeckZone } from '../../store/decks';
import type { EnrichedCard } from '../../types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import type { LaneId, ChangeOwnership } from '@/lib/coach/deck-change';
import type { ArrivalsByType } from '@/lib/coach/new-arrivals';
import type { ComboMatch } from '@/types/combos';
import type { BinderInfo } from '../BinderBadge';
import type { DeckCardActionCtx } from './deck-card-actions';

// ── Props ─────────────────────────────────────────────────────────────────
export interface DeckDisplayCard {
  /** Persisted slot id; when present, used for remove. Generated decks pre-save can omit this. */
  slotId?: string;
  card: ScryfallCard;
  /** scryfallId of the specific collection copy claimed by this slot, if any. */
  allocatedCopyId?: string | null;
  /** Unix ms when this slot was added. Absent on cards predating the field. */
  addedAt?: number;
  /** User tags (E171) — see the `tags` doc on `DeckCard` for the
   *  sticky-override contract (`undefined` = untouched, `[]` = edited/cleared). */
  tags?: string[];
  /** Manual drag-order position (E172) — see the doc on `DeckCard`. */
  sortIndex?: number;
}

export interface DeckDisplayProps {
  title: string;
  /** When set, the card-preview's "In deck" chip is suppressed for this deck. */
  deckId?: string;
  format?: DeckFormat;
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  /** The deck's selected themes (generated decks); refines the identity strip's
   *  archetype to reflect stated intent. Omitted for manual/imported decks. */
  selectedThemes?: ThemeResult[];
  commanderAllocatedCopyId?: string | null;
  partnerCommanderAllocatedCopyId?: string | null;
  cards: DeckDisplayCard[];
  sideboard?: DeckDisplayCard[];
  /**
   * Considering (E122) — park-candidates distinct from the format sideboard.
   * Rendered as its own subordinate, collapsible zone below the sideboard
   * section (list view only, matching the sideboard's own scope). Never
   * folded into `cards`/`sideboard` — excluded from stats/legality/mana
   * analysis by construction (nothing here reads it for those).
   */
  considering?: DeckDisplayCard[];
  /** Optional grade/bracket — if provided, renders in the stats and toolbar. */
  bracketEstimation?: BracketEstimation;
  /** Actual deck cards by name — lets bracket-breakdown card previews show the
   *  deck's printing instead of the default printing fetched by name. */
  deckCardsByName?: ReadonlyMap<string, ScryfallCard>;
  /** User-pinned bracket (1–5); when set it overrides the auto estimate. */
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  /** The estimate was made before the combo match answered, so it is a floor
   *  (combos only raise a bracket). See useCommanderBracketAnalysis. */
  bracketMissesCombos?: boolean;
  /** Set/clear the manual bracket override. Passing null reverts to auto. */
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
  /** Mainboard, one entry per copy: lets the Bracket judgment quote the combo clock. */
  clockLibrary?: readonly ClockCard[];
  /** The Bracket panel's "At the table" read (owner only). */
  bracketTableSlot?: React.ReactNode;
  /** User-pinned archetype; when set it overrides the derived identity headline. */
  archetypeOverride?: Archetype | null;
  /** Set/clear the manual archetype override. Passing null reverts to auto. */
  onSetArchetypeOverride?: (archetype: Archetype | null) => void;
  deckGrade?: { letter: string; headline: string };
  /** 0-100 PlanScore (strategy/roles/curve/cardFit); kept live by the analysis hook. */
  planScore?: PlanScore;
  /** EDHREC's own sample size for this commander (its `numDecks`); kept live
   *  by the analysis hook alongside planScore. Feeds CommanderPopularityStat
   *  (social W4) in DeckIdentityCard. */
  edhrecNumDecks?: number | null;
  /** Mean EDHREC salt score across non-land cards (generated decks only). */
  averageSalt?: number;
  saltiestCards?: Array<{ name: string; salt: number }>;
  /** Role counts from the generator (only present on generated decks). */
  roleCounts?: Record<string, number>;
  /** Target role counts (balanced-roles generation); drives have/want display. */
  roleTargets?: Record<string, number>;
  /** Target counts per DeckCategory bucket (generated decks only) — feeds the
   *  category-view section gauges (E124). Snapshotted at generation, never
   *  recomputed. */
  categoryTargets?: Partial<Record<DeckCategory, number>>;
  /** Post-generation fill+flag report (set at generation only). */
  buildReport?: BuildReport;
  /**
   * EDHREC inclusion rate per card name (0–100), persisted by the analysis
   * hook on generated commander decks. When present, each card row shows a
   * subtle inclusion-% chip. Absent for manual/unanalyzed decks.
   */
  cardInclusionMap?: Record<string, number>;
  /**
   * Every combo (in-deck or one-away) each in-deck card participates in,
   * keyed by oracle id — computed once by the caller from the same
   * `useDeckCombos` data DeckCombosPanel already renders (E216-scoped
   * matcher; see use-deck-combos.ts), never a second match. Drives the
   * inline row-level "CB"/"CB2" superscript badge; omit/empty to render no
   * badges at all.
   */
  combosByOracle?: Map<string, ComboMatch[]>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  /** Editing callback. When provided, each row gets a remove option in its menu. */
  onRemoveCard?: (slotId: string) => void;
  onRemoveSideboardCard?: (slotId: string) => void;
  onRemoveConsideringCard?: (slotId: string) => void;
  /** Move one or more copies of a stacked row across zones, as one undo entry. */
  onMoveToSideboard?: (slotIds: string[]) => void;
  onMoveToMainboard?: (slotIds: string[]) => void;
  /** Mainboard row menu action: park one or more copies in Considering (E122). */
  onMoveToConsidering?: (slotIds: string[]) => void;
  /** Considering row menu action: move one or more copies back to the mainboard. */
  onMoveFromConsidering?: (slotIds: string[]) => void;
  /**
   * Editing callback for the qty cell. When provided, the qty chip becomes
   * a clickable target that swaps to a numeric input on click; committing
   * the value diffs against the current count and adds/removes slots in
   * bulk. Also drives the +/− stepper flanking the chip (non-singleton
   * cards only — see `getMaxCopies`): pass `{ relative: true }` and `qty`
   * becomes a delta (±1) instead of an absolute target, so two rapid taps
   * can't drop an update to a stale closed-over count. Host owns batching
   * (e.g. one undo toast per edit). Zone-aware (E175) — `zone` says which of
   * the deck's three card arrays the edit targets, so passing this through to
   * a sideboard/considering section can never silently touch the mainboard.
   */
  onSetQty?: (
    zone: DeckZone,
    card: ScryfallCard,
    qty: number,
    opts?: { relative?: boolean }
  ) => void;
  /** When provided, each row gets an "Edit printing" option in its menu. */
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  /** When provided, eligible rows get a "Make commander" option in their menu. */
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  /** Predicate that gates the "Make commander" menu item per card. */
  canMakeCommander?: (card: ScryfallCard) => boolean;
  /** When provided, eligible rows get a "Make partner" option in their menu. */
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  /** Predicate that gates the "Make partner" menu item per card (e.g. the card
   *  is a legal partner for the current commander). */
  canMakePartner?: (card: ScryfallCard) => boolean;
  /** When provided, the commander row's menu offers "Change commander",
   *  which opens the commander picker (E465). */
  onChangeCommander?: () => void;
  /** When provided, deck rows offer "Use as deck cover" (deck-card-actions). */
  cover?: DeckCardActionCtx['cover'];
  /** When provided, the Commander section header shows an "Add/Edit partner"
   *  control that opens the partner picker. Pass only when the commander can
   *  actually have a partner. */
  onEditPartner?: () => void;
  /**
   * When provided, eligible rows get a "Move to another deck…" option that
   * reallocates a physical copy out of this deck. Suppressed for the partner
   * commander row (the commander has no portable list slot). Pass only when
   * there's at least one other deck to move into.
   */
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  /**
   * When provided, a row holding an owned physical copy gets a "Release copy"
   * option that frees the copy back to the collection (the slot stays in the
   * deck as a card you still need) — for when you want the card for something
   * else, not a deck.
   */
  onReleaseCopy?: (card: ScryfallCard) => void;
  /**
   * When provided, an unowned row whose every owned copy is in OTHER decks gets
   * a "Use my copy" option that pulls a copy in (routes through the explicit
   * steal-confirm flow).
   */
  onUseOwnCopy?: (card: ScryfallCard) => void;
  /**
   * Open the Shared-copies review for cards this deck wants whose copies are in
   * other decks. Drives the neutral "N cards also in your other decks · Review"
   * banner — pulling a copy in is a conscious per-card choice in the sheet, never
   * a bulk grab. When omitted, the banner is not shown.
   */
  onReviewShared?: () => void;
  /** Lookup of owned cards by scryfallId, for allocation badges + status. */
  collectionByCopyId?: Map<string, EnrichedCard>;
  /** Binder(s) each collection copy is filed in, keyed by copyId — drives
   *  the grid card's binder-membership badge. */
  binderByCopyId?: Map<string, BinderInfo[]>;
  /**
   * Optional parent-controlled state for the Export dialog. When both
   * are provided, the parent owns the open state — useful for opening
   * Export from outside the toolbar (e.g. a page-level action sheet).
   * When omitted, DeckDisplay manages the dialog internally.
   */
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
  /** When provided, the in-deck search shows a "Search Scryfall for X"
   *  trigger (query ≥ 2 chars) that hands the query off to the host's
   *  add panel — so adding a card not in the deck starts from the same
   *  search bar, mirroring the collection page. */
  onAddFromSearch?: (query: string) => void;
  /**
   * Folded-in analysis panels (Combos / EDHREC suggestions). The page builds
   * these so they keep their own data fetching; DeckDisplay slots them into the
   * Power / Improve tabs. (Test hand stays a separate standalone panel.)
   */
  combosSlot?: React.ReactNode;
  /** CoachFeed slot — unified Coach tab surface (NBM + Improve + Cost + Bracket
   *  Fit). Replaces the old improveSlot/nextBestMoveSlot/costSlot/bracketFitSlot.
   *  Built by the page (owns all data + handlers). */
  coachFeedSlot?: React.ReactNode;
  /** Engine *diagnostics* (axis-balance bars + warnings), rendered on the Power
   *  tab. */
  engineSlot?: React.ReactNode;
  /** Win-condition detection panel, rendered on the Power tab. */
  winConditionSlot?: React.ReactNode;
  /** Power-tab verdict hero (bracket + gameplan), rendered atop the Power view. */
  powerHeroSlot?: React.ReactNode;
  /** Opt-in AI review (T96) — rendered at the end of the Stats tab. */
  aiReviewSlot?: React.ReactNode;
  /** Table Record panel (real tracked W/L + head-to-head), rendered on the
   *  Stats tab. Built by the page (owns its own store reads). */
  tableRecordSlot?: React.ReactNode;
  /**
   * In-context "Swap this card": for an in-deck card at `slotId`, return the
   * role-scoped replacement section rendered in the card-preview panel. `close`
   * dismisses the preview after a swap commits (the previewed card is gone).
   * Returns null when there's nothing to offer (e.g. commander, untagged role).
   */
  renderSwapSuggestions?: (
    card: ScryfallCard,
    slotId: string,
    close: () => void
  ) => React.ReactNode;
  /**
   * In-context "Similar cards" section, rendered below the swap suggestions for
   * an in-deck card: owned look-alikes from the collection, then broader
   * discovery. Same `(card, slotId, close)` shape as `renderSwapSuggestions`.
   */
  renderSimilarCards?: (card: ScryfallCard, slotId: string, close: () => void) => React.ReactNode;
  /**
   * Which page-top view is active. `deck` shows the card-list editing surface;
   * the analysis ids show that view full-width (the card list is hidden). The
   * hub tab bar lives in the page (`DeckEditorPage`), which owns this state.
   */
  activeView?: DeckView;
  /** False when the page shows no view tabs (a lone Deck view), so this is
   *  not labelled as a tab panel. */
  tabbed?: boolean;
  /** Reveal the standalone Test hand panel — surfaced in the Deck-view toolbar. */
  onShowTestHand?: () => void;
  /** Opens the add-cards sheet — used by the empty-deck state's CTA (E182). */
  onAddCards?: () => void;
  /**
   * Opens the commander picker (E465). Commander formats only: the empty
   * command zone renders as an open slot whose Choose button calls this, and
   * the empty-deck state offers it beside Add cards.
   */
  onChooseCommander?: () => void;
  /**
   * UX-310: whether the async commander-deck analysis is still in-flight for
   * the first time. When 'pending', the Coach and Power tabs render skeleton
   * placeholders instead of blank space. 'ready' (default) renders
   * normally — slots that are undefined simply don't appear. E162: 'error'
   * means the first analysis attempt failed/stalled (EDHREC unreachable, the
   * commander isn't indexed yet, …) — renders a failure message + retry
   * affordance instead of skeletoning forever.
   */
  analysisState?: 'pending' | 'ready' | 'error';
  /**
   * UX-311: deep-link from a StatsHero shortfall line to the Coach filter that
   * addresses it. The page switches to the Coach tab and activates the matching
   * filter chip. Only passed for commander decks that have a full analysis result.
   */
  onNavigateToTune?: (lane: LaneId) => void;
  /** E162: retries a failed/stalled first analysis. Passed only when analysisState is 'error'. */
  onRetryAnalysis?: () => void;
  /**
   * The persisted analysis was computed without EDHREC (unreachable / this
   * commander isn't indexed) — bracket + win conditions are real, but
   * grade/plan score/gap/optimize/cost lanes are absent. Drives a small
   * retryable notice where that content would otherwise be.
   */
  edhrecMissing?: boolean;
  /**
   * Session-scoped reveal key for score animations. When non-null, plays the
   * 0→target reveal tween on first delivery; null/undefined suppresses the reveal.
   * Computed by the page from deck.id + gradeBracketSignature.
   */
  scoreRevealKey?: string | null;
  /** One-tap add on a Build Report suggestion row (synergyFills/packagePicks).
   *  Omitted → the rows stay read-only prose. */
  onAddSuggestedCard?: (cardName: string) => void;
  /** Open slots in an under-size Commander deck, and the "Fill the rest"
   *  sheet that fills them. Both set only when there's something to fill. */
  openSlots?: number;
  onFill?: () => void;
  /** Card names with an add in flight from a Build Report row (exact case,
   *  mirrors the Coach/NBM `busyNames` convention). */
  addingSuggestedCardNames?: ReadonlySet<string>;
  /** Live Spellbook one-away combos for the Build Report section (E78-P4). */
  oneAwayCombos?: ComboMatch[];
  /** Owned oracle ids — ranks owned-missing-piece combos first. */
  ownedOracleIds?: ReadonlySet<string>;
  /** Stronger owned lands the merit-based engine found → the Mana base
   *  "Re-analyze lands" CTA on the Stats tab. */
  landUpgradeCount?: number;
  /**
   * Per-category "new arrivals" (E140) — collection cards acquired since the
   * deck was last updated/reviewed, bucketed by classifyType and ranked. The
   * page computes this (see `lib/coach/new-arrivals.ts`) so DeckDisplay just renders
   * the "✦ N new" header chip per section and the review sheet on tap.
   * Omitted (e.g. read-only/shared views) → no chip anywhere.
   */
  arrivalsByType?: ArrivalsByType;
  /** Exact-case in-deck names → count (mainboard + sideboard) — feeds the
   *  open sheet's live "Added" row state. */
  existingCardCounts?: ReadonlyMap<string, number>;
  /** Allocation-aware ownership per card name — badges the arrivals sheet's rows
   *  (E246). Omitted (read-only/shared views) → no badges. */
  ownershipFor?: (name: string) => ChangeOwnership;
  /** Stamp deck.lastArrivalReviewAt (silent) — fired once the sheet closes. */
  onMarkArrivalsReviewed?: () => void;
  /** Open the new-arrivals sheet once, as soon as it has rows — Home's
   *  "+N new cards" badge lands here (`?arrivals=1`). The host sets it only
   *  after every arrivals input has loaded, since the sheet freezes its rows
   *  when it opens. */
  autoOpenArrivals?: boolean;
  /**
   * User tags (E171). All three optional — omitted (e.g. a read-only/shared
   * view) means tags still DISPLAY (chips render from `cards`/`sideboard`/
   * `considering`'s own `tags` field) but the editor and tag manager don't
   * render any controls.
   */
  onSetCardTags?: (zone: DeckZone, slotIds: string[], tags: string[]) => void;
  onRenameDeckTag?: (from: string, to: string) => void;
  onRemoveDeckTag?: (tag: string) => void;
  /**
   * Multi-select bulk operations (E172). All optional — when omitted, the
   * "Select" toolbar toggle doesn't render at all (mirrors how the tag props
   * above gate the tag editor). Each fires exactly once per confirmed bulk
   * action, whatever the selection size — the host wraps it in one store
   * write + one undo entry.
   */
  onBulkRemove?: (zone: DeckZone, slotIds: string[]) => void;
  onBulkMove?: (slotIds: string[], from: DeckZone, to: DeckZone) => void;
  onBulkEditTag?: (zone: DeckZone, slotIds: string[], tag: string, add: boolean) => void;
  /**
   * Manual drag reorder (E172), list view only. DeckDisplay computes the
   * fractional sortIndex itself (pure — see lib/deck/deck-reorder.ts) and hands
   * off the already-computed value; the host just persists it. Omitted →
   * the 'custom' sort option still shows but drag handles never render.
   */
  onReorder?: (zone: DeckZone, slotIds: string[], sortIndex: number) => void;
}

// ── Analysis views ─────────────────────────────────────────────────────────
/** The page-top analysis view ids. (Test hand is a separate standalone panel,
 *  not a view — goldfishing is a distinct activity.) */
export type AnalysisTabId = 'stats' | 'power' | 'tune';

/** The full page-top view set: the card-list editing surface plus the analysis
 *  views. `DeckEditorPage` owns this state and renders the hub tab bar. */
export type DeckView = 'deck' | AnalysisTabId;
