import { CircleAlert, Layers, Pencil, Search, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrency } from '@/lib/currency';
import { createPortal } from 'react-dom';
import type {
  ScryfallCard,
  DeckCategory,
  DeckFormat,
  ThemeResult,
  BuildReport,
  Archetype,
} from '@/deck-builder/types';
import { suggestedTagForCard, collectDeckTags } from '@/lib/deck-tags';
import { DeckTagManager } from './DeckTagManager';
import { ConfirmDialog } from '../ConfirmDialog';
import { buildManaData, tallyNames, type TypeGroup } from '@/lib/build-mana-data';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  validateDeck as runValidation,
  validateDeckSize,
  countFlaggedCards,
  effectiveDeckColors,
  COMMANDER_SLOT_ID,
  PARTNER_COMMANDER_SLOT_ID,
  type LegalityIssue,
} from '../../lib/deck-validation';
import { useSealMoment } from '../shared/SealMoment';
import { DeckExportDialog } from '../shared/DeckExportDialog';
import {
  buildExport,
  readStoredExportFormat,
  writeStoredExportFormat,
  type ExportFormat,
} from '@/lib/deck-export';
import { toast } from '../../store/toasts';
import { haptics } from '../../lib/haptics';
import type { DeckCard, DeckZone } from '../../store/decks';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { formatMoney } from '../../lib/format-money';
import { InfoTip } from '../InfoTip';
import { CardPreview, type CardPreviewAction } from '../CardPreview';
import { CardPreviewContext } from '../CardPreviewContext';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';
import { BuyListDialog } from './BuyListDialog';
import { DeckHoverPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useTouchPeek } from '@/lib/use-touch-peek';
import {
  buildAllocationMap,
  classifyAllocation,
  type AllocationInfo,
  type AllocationStatus,
} from '../../lib/allocations';
import { useTaggerReady } from '@/lib/use-tagger-ready';

import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { useRarityCorrections } from '../../lib/use-rarity-corrections';
import type { EnrichedCard } from '../../types';
import { type BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { LaneId, ChangeOwnership } from '@/lib/deck-change';
import { useCardCarousel, tallyToEntries, type CarouselEntry } from './useCardCarousel';
import { NewArrivalsSheet } from './NewArrivalsSheet';
import type { ArrivalsByType } from '@/lib/new-arrivals';
import type { ComboMatch } from '@/types/combos';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  buildValidationChecklist,
  summarizeValidation,
  type ValidationSummary,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import {
  buildCommanderProfile,
  whyCardMatches,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { deriveDeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';
import { ROLE_TITLES, type RoleKey } from '../../lib/role-badges';
import { Tabs } from '../Tabs';
import { clampZoom, readStoredZoom } from '@/lib/grid-zoom';
import { useElementWidth } from '@/lib/use-element-width';

import { type BinderInfo } from '../BinderBadge';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { ToolbarPopover } from '../shared/ToolbarPopover';
import {
  resolveInclusionPct,
  cardFilterRoles,
  priceOf,
  readStoredViewMode,
  readStoredShowPrefs,
  readStoredGroupBy,
  frontFaceImage,
  backFaceImage,
  frontFaceImageLarge,
  backFaceImageLarge,
  colorKeyOf,
  buildRows,
  SORT_DEFAULT_DIR,
  findClaimedBy,
  groupByType,
  groupByCategory,
  groupByTag,
  applyFilterSort,
  VIEW_MODE_STORAGE_KEY,
  SHOW_PREFS_STORAGE_KEY,
  GROUP_BY_STORAGE_KEY,
  type CurrencyCode,
  type SortMode,
  type DeckViewMode,
  type ShowPrefs,
  type DeckGroupBy,
  type Row,
  type CrossDeckCtx,
} from './deck-display-rows';
import { renderArrivalsChip, PartnerHeaderButton } from './deck-display-icons';
import { DeckToolbar } from './DeckToolbar';
import { DeckCardGrid } from './DeckCardGrid';
import { CategorySection } from './DeckMainboardRow';
import { DeckAnalysisView } from './DeckAnalysisView';

/** Deck ids whose completion moment already played this app-open — an edit
 *  that re-crosses the complete boundary doesn't re-celebrate (mirrors the
 *  consumedRevealKeys registry's once-per-session semantics). */
const celebratedDeckComplete = new Set<string>();

const GRID_SIZE_STORAGE_KEY = 'mtg-decks-grid-size';

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
  /** Deck accent color hex (from deck.color). Used in the identity hero banner. */
  color?: string;
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
  /** Set/clear the manual bracket override. Passing null reverts to auto. */
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
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
  /**
   * Reports the deck-health roll-up whenever it changes, so the page's view
   * tabs can badge the Stats tab with the same verdict the Stats board shows.
   * Must be referentially stable (the effect that calls it depends on it).
   */
  onDeckHealthChange?: (summary: ValidationSummary) => void;
  /** Reveal the standalone Test hand panel — surfaced in the Deck-view toolbar. */
  onShowTestHand?: () => void;
  /** Opens the add-cards sheet — used by the empty-deck state's CTA (E182). */
  onAddCards?: () => void;
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
   * Session-scoped reveal key for score animations. When non-null, plays the
   * 0→target reveal tween on first delivery; null/undefined suppresses the reveal.
   * Computed by the page from deck.id + gradeBracketSignature.
   */
  scoreRevealKey?: string | null;
  /** One-tap add on a Build Report suggestion row (synergyFills/packagePicks).
   *  Omitted → the rows stay read-only prose. */
  onAddSuggestedCard?: (cardName: string) => void;
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
   * page computes this (see `lib/new-arrivals.ts`) so DeckDisplay just renders
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
   * fractional sortIndex itself (pure — see lib/deck-reorder.ts) and hands
   * off the already-computed value; the host just persists it. Omitted →
   * the 'custom' sort option still shows but drag handles never render.
   */
  onReorder?: (zone: DeckZone, slotIds: string[], sortIndex: number) => void;
}

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  deckId,
  format = 'commander',
  color,
  commander,
  partnerCommander,
  selectedThemes,
  commanderAllocatedCopyId,
  partnerCommanderAllocatedCopyId,
  cards,
  sideboard = [],
  considering = [],
  bracketEstimation,
  deckCardsByName,
  bracketOverride,
  onSetBracketOverride,
  archetypeOverride,
  onSetArchetypeOverride,
  // deckGrade: removed from stat-strip (UX-315: one grading system; letter grades dropped)
  planScore,
  edhrecNumDecks,
  averageSalt,
  saltiestCards,
  roleCounts,
  roleTargets,
  categoryTargets,
  buildReport,
  cardInclusionMap,
  combosByOracle,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  onRemoveCard,
  onRemoveSideboardCard,
  onRemoveConsideringCard,
  onMoveToSideboard,
  onMoveToMainboard,
  onMoveToConsidering,
  onMoveFromConsidering,
  onSetQty,
  onEditCard,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onEditPartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  onReviewShared,
  collectionByCopyId,
  binderByCopyId,
  exportOpen: exportOpenProp,
  onExportOpenChange,
  onAddFromSearch,
  combosSlot,
  coachFeedSlot,
  engineSlot,
  winConditionSlot,
  powerHeroSlot,
  tableRecordSlot,
  aiReviewSlot,
  renderSwapSuggestions,
  renderSimilarCards,
  activeView = 'deck',
  onDeckHealthChange,
  onShowTestHand,
  onAddCards,
  analysisState = 'ready',
  onNavigateToTune,
  onRetryAnalysis,
  scoreRevealKey,
  onAddSuggestedCard,
  addingSuggestedCardNames,
  oneAwayCombos,
  ownedOracleIds,
  landUpgradeCount,
  arrivalsByType,
  existingCardCounts,
  ownershipFor,
  onMarkArrivalsReviewed,
  onSetCardTags,
  onRenameDeckTag,
  onRemoveDeckTag,
  onBulkRemove,
  onBulkMove,
  onBulkEditTag,
  onReorder,
}: DeckDisplayProps) {
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  const currency: CurrencyCode = useCurrency();
  // New-arrivals review (E140): which category's sheet is open, if any.
  const [openArrivalsBucket, setOpenArrivalsBucket] = useState<TypeGroup | null>(null);
  const [sort, setSort] = useState<SortMode>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onToggleSort = (m: SortMode) => {
    if (m === sort) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(m);
      setSortDir(SORT_DEFAULT_DIR[m]);
    }
  };
  const [search, setSearch] = useState('');
  // "Not in the deck" zone (E176): which of the two zones the segmented
  // switch shows. Defaults to whichever actually holds cards (Sideboard
  // unless it's empty and Considering isn't) so newly-routed import extras
  // / parked suggestions are visible without an extra tap — same intent as
  // the old Considering auto-open heuristic, adapted to a tab switch.
  // Lazy-init only — the user's own tap afterward always wins, it doesn't
  // re-derive as cards move in/out while mounted.
  const [outzoneTab, setOutzoneTab] = useState<'sideboard' | 'considering'>(() =>
    sideboard.length === 0 && considering.length > 0 ? 'considering' : 'sideboard'
  );

  // ── Multi-select (E172) ──────────────────────────────────────────────────
  // A deliberate mode the user opts into via the toolbar's "Select" toggle —
  // mirrors CardListTable's selectMode pattern (see STYLE_GUIDE.md "Selection
  // mode & drag reorder"). Row tap/Enter/Space stays "open preview" until
  // this is on; DeckCardRow reroutes it to toggle-select instead. Scoped to
  // ONE zone at a time (a bulk action only ever targets one zone) — the Set
  // holds SLOT ids directly (a row toggle adds/removes its whole stack), so
  // executing a bulk action never needs a row lookup, just `[...keys]`.
  const canBulkEdit = !!(onBulkRemove || onBulkMove || onBulkEditTag);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<{ zone: DeckZone; keys: Set<string> } | null>(null);
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelection(null);
  };
  const isRowSelected = (zone: DeckZone, row: Row): boolean =>
    !!selection &&
    selection.zone === zone &&
    row.slotIds.length > 0 &&
    row.slotIds.every((id) => selection.keys.has(id));
  const toggleRowSelected = (zone: DeckZone, row: Row) => {
    if (row.slotIds.length === 0) return;
    setSelection((cur) => {
      const sameZone = cur && cur.zone === zone;
      const keys = sameZone ? new Set(cur!.keys) : new Set<string>();
      const selected = row.slotIds.every((id) => keys.has(id));
      for (const id of row.slotIds) {
        if (selected) keys.delete(id);
        else keys.add(id);
      }
      return keys.size === 0 ? null : { zone, keys };
    });
  };
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => readStoredExportFormat());
  const [viewMode, setViewMode] = useState<DeckViewMode>(() => readStoredViewMode());
  const [groupBy, setGroupBy] = useState<DeckGroupBy>(() => readStoredGroupBy());
  const [gridZoom, setGridZoom] = useState(() => readStoredZoom(GRID_SIZE_STORAGE_KEY));
  const [showPrefs, setShowPrefs] = useState<ShowPrefs>(() => readStoredShowPrefs());
  // Mirrors the collection grid: on narrow viewports the top zoom steps
  // all render as a single full-width column, so the reachable range is
  // capped (without overwriting the stored value).
  const [isNarrowGrid, setIsNarrowGrid] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsNarrowGrid(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  const effectiveGridZoom = clampZoom(gridZoom, isNarrowGrid);
  // Measured width of a rendered card grid — the zoom stepper needs it to skip
  // steps that wouldn't change the column count at this size. Measured on the
  // `<ul>` itself, not its section wrapper, which adds horizontal padding.
  const [gridRef, gridWidth] = useElementWidth<HTMLUListElement>();

  const handleExportFormatChange = (f: ExportFormat) => {
    setExportFormat(f);
    writeStoredExportFormat(f);
  };
  const handleViewModeChange = (m: DeckViewMode) => {
    setViewMode(m);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const handleGroupByChange = (g: DeckGroupBy) => {
    setGroupBy(g);
    try {
      window.localStorage.setItem(GROUP_BY_STORAGE_KEY, g);
    } catch {
      /* ignore */
    }
  };
  const handleGridZoomChange = (z: number) => {
    setGridZoom(z);
    try {
      window.localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(z));
    } catch {
      /* ignore */
    }
  };
  const handleShowPrefsChange = (next: ShowPrefs) => {
    setShowPrefs(next);
    try {
      window.localStorage.setItem(SHOW_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // The analysis surface is now a set of page-top distinct views (the hub tab
  // bar lives in DeckEditorPage and owns the active view), so there's no
  // collapse state or desktop side-column to track here — `activeView` decides
  // what this component renders.

  // Cross-deck context: lets us distinguish "you don't own this card" from
  // "you own it, but a different deck has the copy claimed". We exclude the
  // current deck's own allocations so a slot in *this* deck doesn't count
  // as "claimed elsewhere" against itself.
  const allDecks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const crossDeck: CrossDeckCtx = useMemo(() => {
    if (!collectionByCopyId) return {};
    const copiesByName = new Map<string, EnrichedCard[]>();
    for (const copy of collectionByCopyId.values()) {
      const key = copy.name.toLowerCase();
      const list = copiesByName.get(key);
      if (list) list.push(copy);
      else copiesByName.set(key, [copy]);
    }
    const others = deckId ? allDecks.filter((d) => d.id !== deckId) : allDecks;
    // Physical cubes are always "other" (a cube is never the deck being viewed),
    // so a copy committed to a cube reads as claimed-elsewhere here too.
    const otherDeckAllocations = buildAllocationMap(others, savedCubes);
    return { copiesByName, otherDeckAllocations };
  }, [collectionByCopyId, allDecks, savedCubes, deckId]);

  const claimedByForName = useCallback(
    (cardName: string) => findClaimedBy(cardName, crossDeck),
    [crossDeck]
  );

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const push = (c: ScryfallCard, allocatedCopyId?: string | null, isPartner = false) => {
      const owned = allocatedCopyId ? collectionByCopyId?.get(allocatedCopyId) : undefined;
      const status: AllocationStatus = classifyAllocation(
        allocatedCopyId ?? null,
        collectionByCopyId,
        {
          cardName: c.name,
          copiesByName: crossDeck.copiesByName,
          allocations: crossDeck.otherDeckAllocations,
        }
      );
      rows.push({
        name: c.name,
        qty: 1,
        card: c,
        printings: [],
        cmc: c.cmc ?? 0,
        price: priceOf(c, currency),
        colorKey: colorKeyOf(c),
        addedAt: 0,
        slotIds: [],
        allocatedCopyIds: allocatedCopyId ? [allocatedCopyId] : [],
        status,
        allocatedQty: status === 'allocated' ? 1 : 0,
        unownedQty: status === 'unowned' ? 1 : 0,
        orphanQty: status === 'orphan' ? 1 : 0,
        claimedElsewhereQty: status === 'claimed-elsewhere' ? 1 : 0,
        claimedBy: status === 'claimed-elsewhere' ? claimedByForName(c.name) : undefined,
        imageNormal: owned?.imageNormal ?? frontFaceImage(c),
        imageNormalBack: owned?.imageNormalBack ?? backFaceImage(c),
        imageLarge: owned?.imageLarge ?? frontFaceImageLarge(c),
        imageLargeBack: owned?.imageLargeBack ?? backFaceImageLarge(c),
        foil: owned?.foil ?? false,
        finish: owned?.finish ?? 'nonfoil',
        finishes: owned?.finishes,
        promoTypes: owned?.promoTypes,
        frameEffects: owned?.frameEffects,
        setCode: owned?.setCode || c.set || '',
        setName: owned?.setName || c.set_name,
        collectorNumber: owned?.collectorNumber || c.collector_number || '',
        isPartner,
        legalitySlotKey: isPartner ? PARTNER_COMMANDER_SLOT_ID : COMMANDER_SLOT_ID,
        // Commanders have no deck slot to tag (E171 is a mainboard/side/
        // considering concept) — always untouched/untagged.
        tags: [],
        tagsEdited: false,
      });
    };
    if (commander) push(commander, commanderAllocatedCopyId);
    if (partnerCommander) push(partnerCommander, partnerCommanderAllocatedCopyId, true);
    return rows;
  }, [
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
    crossDeck,
    claimedByForName,
    currency,
  ]);

  // Whether the bundled tagger data (role classification) has loaded —
  // gates category-view grouping below, same source as the role-filter bar's
  // roleFilterEntries further down. Declared here (rather than down by the
  // role filter) so the mainboard groups memo can depend on it too.
  const taggerReady = useTaggerReady();

  // Non-commander rows grouped by the active groupBy lens. STABILITY: the
  // dep array below deliberately excludes anything derived from
  // useCommanderBracketAnalysis (roleTargets/bracketEstimation/planScore/…) —
  // category buckets settle ONCE when taggerReady flips true and must never
  // re-shuffle from a background/derived write (product hard rule). Pre-
  // taggerReady, untagged cards fall to 'synergy'; that's fine, it's the same
  // one-time settle as the role-filter bar's counts.
  const groups = useMemo(() => {
    const rows = buildRows(cards, currency, collectionByCopyId, crossDeck);
    if (groupBy === 'tag') return groupByTag(rows, commanderRows);
    return groupBy === 'category'
      ? groupByCategory(rows, categoryTargets, commanderRows)
      : groupByType(rows, commanderRows);
  }, [
    cards,
    commanderRows,
    collectionByCopyId,
    crossDeck,
    currency,
    groupBy,
    categoryTargets,
    taggerReady,
  ]);

  // Every distinct user tag across the WHOLE deck (all 3 zones, unfiltered
  // by search/groupBy) — the tag manager's "see all tags" list. Deliberately
  // independent of `visibleGroups` so it's stable while searching/grouping.
  const deckTags = useMemo(
    () => collectDeckTags({ cards, sideboard, considering }),
    [cards, sideboard, considering]
  );

  // Sideboard rows always stay type-grouped — the sideboard is a small,
  // rarely-consulted holding list, not the shape-story surface the category
  // gauges explain; type grouping keeps it simple and consistent regardless
  // of the mainboard's lens.
  const sideboardGroups = useMemo(
    () =>
      sideboard.length === 0
        ? []
        : groupByType(buildRows(sideboard, currency, collectionByCopyId, crossDeck)),
    [sideboard, collectionByCopyId, crossDeck, currency]
  );

  // Considering (E122) — same type-grouped, non-shape-story treatment as the
  // sideboard: a small holding list, not the category-gauge surface.
  const consideringGroups = useMemo(
    () =>
      considering.length === 0
        ? []
        : groupByType(buildRows(considering, currency, collectionByCopyId, crossDeck)),
    [considering, collectionByCopyId, crossDeck, currency]
  );

  // Legality issues for the current format.
  const legalityIssues = useMemo(() => {
    const mainDeckCards: DeckCard[] = cards.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    const sideDeckCards: DeckCard[] = sideboard.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    return runValidation(mainDeckCards, sideDeckCards, formatConfig, {
      commander,
      partnerCommander: partnerCommander ?? null,
    });
  }, [cards, sideboard, formatConfig, commander, partnerCommander]);

  const legalityBySlot = useMemo(() => {
    const map = new Map<string, LegalityIssue>();
    for (const issue of legalityIssues) {
      // Prefer the more specific issue type if multiple apply to the same slot.
      // Color-identity and not-legal both signal "this card does not belong";
      // copy-limit is a separate flavor. Keep whichever we saw first since the
      // tooltip only has room for one detail line anyway.
      if (!map.has(issue.slotId)) map.set(issue.slotId, issue);
    }
    return map;
  }, [legalityIssues]);

  const flaggedCardCount = useMemo(() => countFlaggedCards(legalityIssues), [legalityIssues]);

  const deckSizeWarning = useMemo(
    () => validateDeckSize(cards.length, formatConfig),
    [cards.length, formatConfig]
  );

  // Deck-complete moment: the edit that takes the deck from incomplete to
  // exactly full-size with zero legality flags earns the seal + a toast —
  // today that boundary is a silent badge repaint. Fires only on a transition
  // observed while mounted (never on opening an already-complete deck), and
  // once per deck per app-open (the module-level set), so re-cross edits
  // don't re-celebrate.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const prevDeckComplete = useRef<boolean | null>(null);
  useEffect(() => {
    const complete =
      cards.length > 0 && cards.length === formatConfig.mainboardSize && flaggedCardCount === 0;
    if (
      prevDeckComplete.current === false &&
      complete &&
      deckId &&
      !celebratedDeckComplete.has(deckId)
    ) {
      celebratedDeckComplete.add(deckId);
      const colors = [
        ...effectiveDeckColors({
          commander: commander ?? null,
          partnerCommander: partnerCommander ?? null,
          cards: cards.map((c) => ({
            slotId: c.slotId ?? '',
            card: c.card,
            allocatedCopyId: c.allocatedCopyId ?? null,
          })),
        }),
      ];
      fireSealMoment(colors);
      haptics.success();
      toast.show({
        message: `Deck complete — legal for ${formatConfig.label}`,
        tone: 'success',
      });
    }
    prevDeckComplete.current = complete;
  }, [cards, flaggedCardCount, formatConfig, deckId, commander, partnerCommander, fireSealMoment]);

  const visibleGroups = useMemo(
    () => applyFilterSort(groups, search, sort, sortDir),
    [groups, search, sort, sortDir]
  );

  const visibleSideboardGroups = useMemo(
    () => applyFilterSort(sideboardGroups, search, sort, sortDir),
    [sideboardGroups, search, sort, sortDir]
  );

  const visibleConsideringGroups = useMemo(
    () => applyFilterSort(consideringGroups, search, sort, sortDir),
    [consideringGroups, search, sort, sortDir]
  );

  // No card in the deck (main, sideboard, or considering) matches the current
  // query — the cue to surface the "search Scryfall to add it" trigger.
  const noDeckMatches =
    !visibleGroups.some((g) => g.rows.length > 0) &&
    !visibleSideboardGroups.some((g) => g.rows.length > 0) &&
    !visibleConsideringGroups.some((g) => g.rows.length > 0);

  // Flat list for stats panels (commanders included, since color identity
  // and curve are commander-relevant too).
  const allCards = useMemo<ScryfallCard[]>(() => {
    const list: ScryfallCard[] = [];
    if (commander) list.push(commander);
    if (partnerCommander) list.push(partnerCommander);
    for (const dc of cards) list.push(dc.card);
    return list;
  }, [commander, partnerCommander, cards]);

  // The deck's legal color identity = the commander(s)' combined identity.
  // Undefined when there's no commander, which skips the identity validation gate.
  const commanderIdentity = useMemo<string[] | undefined>(() => {
    if (!commander) return undefined;
    const set = new Set<string>();
    for (const c of [commander, partnerCommander]) {
      for (const k of c?.color_identity ?? []) set.add(k);
    }
    return [...set];
  }, [commander, partnerCommander]);

  // The commander's parsed ability profile — shared by the per-card synergy
  // reasons and the deck-identity strip.
  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander, partnerCommander) : null),
    [commander, partnerCommander]
  );

  // Live-computed deck identity (archetype + pacing + themes), derived from the
  // current card list so it stays honest as the deck is edited. The archetype
  // label single-sources from the persisted build report when this is a
  // generated deck (buildReport.archetype — what generation actually used for
  // role targets/land count/type floor), so the headline never disagrees with
  // the build; manual/imported decks (no buildReport) keep the oracle-text
  // fallback pickArchetype already computed from the commander alone.
  const identity = useMemo(
    () =>
      commanderProfile
        ? deriveDeckIdentity({
            profile: commanderProfile,
            selectedThemes,
            cards: allCards,
            persistedArchetype: archetypeOverride ?? buildReport?.archetype,
          })
        : null,
    [commanderProfile, selectedThemes, allCards, buildReport?.archetype, archetypeOverride]
  );

  // "Why this card" synergy reasons, keyed by card name. Computed from the
  // commander's parsed ability profile so each row can explain its fit.
  const synergyByName = useMemo<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    if (!commanderProfile || commanderProfile.abilities.length === 0) return map;
    for (const dc of cards) {
      const card = dc.card;
      if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) continue;
      if (map.has(card.name)) continue;
      const reasons = whyCardMatches(card, commanderProfile);
      if (reasons.length > 0) map.set(card.name, reasons);
    }
    return map;
  }, [commanderProfile, cards]);

  // Per-card pick provenance (S2 — "why is this here"), keyed by card name.
  // Set only on decks generated after this shipped; absent (undefined) for
  // manual/imported/older decks, which keeps every row's tooltip exactly as
  // it rendered before this feature existed.
  const cardProvenance = buildReport?.cardProvenance;

  // Stats summary line.
  const totalCards = allCards.length;
  const totalPrice = useMemo(
    () => allCards.reduce((sum, c) => sum + priceOf(c, currency), 0),
    [allCards, currency]
  );
  // Missing summary — cards in the deck that aren't allocated to a collection
  // copy (i.e. status !== 'allocated'). Surfaces buy-list info inline so we
  // don't need a separate banner above the deck.
  const missing = useMemo(() => {
    let count = 0;
    let price = 0;
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
      if (status === 'allocated') continue;
      count += 1;
      price += priceOf(dc.card, currency);
    }
    return { count, price };
  }, [cards, collectionByCopyId, currency]);
  // Owned-but-elsewhere count — mainboard cards you own where every copy is in
  // another deck. Drives the "Use my copies (N)" resolver banner. Uses the same
  // cross-deck context as the per-row chips so the number matches the rows.
  const claimedElsewhereCount = useMemo(() => {
    if (!crossDeck.copiesByName || !crossDeck.otherDeckAllocations) return 0;
    let n = 0;
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId, {
        cardName: dc.card.name,
        copiesByName: crossDeck.copiesByName,
        allocations: crossDeck.otherDeckAllocations,
      });
      if (status === 'claimed-elsewhere') n += 1;
    }
    return n;
  }, [cards, collectionByCopyId, crossDeck]);
  // Tally of the unallocated (missing) cards — the tappable "missing" stat opens
  // a carousel of these so the count doubles as a shopping list.
  const missingTally = useMemo(() => {
    const list: ScryfallCard[] = [];
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
      if (status === 'allocated') continue;
      list.push(dc.card);
    }
    return tallyNames(list);
  }, [cards, collectionByCopyId]);
  // Tally of every card in the deck (commanders included), feeding the tappable
  // "cards" stat → swipe the whole list.
  const deckTally = useMemo(() => tallyNames(allCards), [allCards]);
  // The deck's cards as carousel entries sorted by price (desc) — the tappable
  // "value" stat opens the most expensive cards first, each labeled with its
  // price so the carousel reads as a value breakdown.
  const valueEntries = useMemo<CarouselEntry[]>(() => {
    return tallyNames(allCards)
      .slice()
      .sort((a, b) => priceOf(b.card, currency) - priceOf(a.card, currency))
      .map((t) => ({
        name: t.name,
        label: formatMoney(priceOf(t.card, currency), { currency }),
        card: t.card,
      }));
  }, [allCards, currency]);
  // Mana curve / color demand+production / type breakdown / drill-downs — the
  // shared pure builder so this view and the deck-compare page agree exactly.
  const manaData = useMemo(
    () => buildManaData(allCards, commander, partnerCommander),
    [allCards, commander, partnerCommander]
  );

  // Generated decks pass roleCounts in; manual decks don't — derive them on
  // the fly from the tagger so the Roles panel works for either flow.
  const derivedRoles = useMemo(() => {
    if (roleCounts !== undefined) return null;
    return computeRoleCounts(allCards);
  }, [allCards, roleCounts]);

  // Pass/fail deck-health checklist for the Stats board — legality gates plus the
  // soft role/curve targets, derived from the live list + role analysis. Lives
  // here rather than in DeckAnalysisView so the Deck view can report the same
  // verdict upward (E223's tab badge) without a second, drifting computation.
  const validation = useMemo(
    () =>
      buildValidationChecklist({
        cards: allCards,
        commanderIdentity,
        roleCounts: roleCounts ?? derivedRoles?.roleCounts,
        roleTargets,
        averageCmc: manaData.averageCmc,
        format: formatConfig,
      }),
    [
      allCards,
      commanderIdentity,
      roleCounts,
      derivedRoles,
      roleTargets,
      manaData.averageCmc,
      formatConfig,
    ]
  );

  // Report the roll-up to the page so the view tabs can badge it. The memo above
  // is the only trigger, so this fires on real deck changes, not every render.
  useEffect(() => {
    onDeckHealthChange?.(summarizeValidation(validation));
  }, [validation, onDeckHealthChange]);

  const exportText = useMemo(
    () =>
      buildExport(
        {
          commander,
          partner: partnerCommander,
          cards,
          sideboard,
          considering,
          collectionByCopyId,
          commanderAllocatedCopyId,
          partnerAllocatedCopyId: partnerCommanderAllocatedCopyId,
        },
        exportFormat
      ),
    [
      commander,
      partnerCommander,
      cards,
      exportFormat,
      sideboard,
      considering,
      collectionByCopyId,
      commanderAllocatedCopyId,
      partnerCommanderAllocatedCopyId,
    ]
  );
  // If the parent passes both props, treat it as a controlled component
  // (their boolean wins). Otherwise fall back to internal state — keeps
  // simple callers ergonomic and avoids any setState-in-effect dance.
  const [internalExportOpen, setInternalExportOpen] = useState(false);
  // Buy-list dialog for the missing cards — the missing stat's drill-down.
  // Tapping a row swaps the dialog for the card carousel at that card;
  // `buyListReturn` re-opens the dialog when that carousel closes, so the
  // carousel reads as a preview layer over the list rather than a dead end.
  const [buyListOpen, setBuyListOpen] = useState(false);
  const buyListReturn = useRef(false);
  const isControlled = exportOpenProp !== undefined && onExportOpenChange !== undefined;
  const exportOpen = isControlled ? exportOpenProp : internalExportOpen;
  const setExportOpen = (next: boolean) => {
    if (isControlled) onExportOpenChange(next);
    else setInternalExportOpen(next);
  };

  // ── Card preview wiring ──────────────────────────────────────────────
  // Re-resolve rarity for cards whose stored snapshot defaulted to 'common'
  // (decks generated against the pre-#329 offline oracle). See the hook doc.
  // All three zones, not just the mainboard: `flat` below applies these
  // corrections to cards/sideboard/considering alike, so feeding only
  // `visibleGroups` left a card that lives ONLY in the sideboard or in
  // Considering stuck on its stale 'common' snapshot forever. The hook dedupes
  // by oracle id internally, so the tag-grouped view's repeated rows cost
  // nothing here.
  const previewCards = useMemo<ScryfallCard[]>(
    () =>
      [...visibleGroups, ...visibleSideboardGroups, ...visibleConsideringGroups].flatMap((g) =>
        g.rows.map((r) => r.card)
      ),
    [visibleGroups, visibleSideboardGroups, visibleConsideringGroups]
  );
  const rarityCorrections = useRarityCorrections(previewCards);
  const flat = useMemo(() => {
    const enrichedCards: EnrichedCard[] = [];
    const labels: string[] = [];
    const rows: Row[] = [];
    const zones: DeckZone[] = [];
    const indexByName = new Map<string, number>();
    // Mainboard first, then sideboard, then considering — so the carousel +
    // hover-peek resolve those cards too (same inspect path as the
    // mainboard). A name only in one zone maps to that zone's entry; a name
    // in more than one keeps the earliest zone's (first wins).
    const pushGroups = (groups: typeof visibleGroups, zone: DeckZone) => {
      // Tag groupBy is NOT a partition (E171) — a multi-tagged row can appear
      // in more than one of `groups`. Dedupe within this zone's pass so the
      // carousel never repeats the same card as consecutive slides.
      const pushedThisZone = new Set<string>();
      for (const g of groups) {
        for (const row of g.rows) {
          if (pushedThisZone.has(row.name)) continue;
          pushedThisZone.add(row.name);
          if (!indexByName.has(row.name)) indexByName.set(row.name, enrichedCards.length);
          rows.push(row);
          zones.push(zone);
          enrichedCards.push(
            scryfallToEnrichedCard(row.card, {
              frontImageOverride: row.imageNormal,
              backImageOverride: row.imageNormalBack,
              sourceFormat: 'deck-builder',
              overrides: {
                foil: row.foil,
                finish: row.finish,
                finishes: row.finishes,
                promoTypes: row.promoTypes,
                frameEffects: row.frameEffects,
                setCode: row.setCode,
                setName: row.setName,
                collectorNumber: row.collectorNumber,
                rarity: row.card.oracle_id ? rarityCorrections.get(row.card.oracle_id) : undefined,
              },
            })
          );
          labels.push(g.title);
        }
      }
    };
    pushGroups(visibleGroups, 'cards');
    pushGroups(visibleSideboardGroups, 'sideboard');
    pushGroups(visibleConsideringGroups, 'considering');
    return { cards: enrichedCards, labels, rows, zones, indexByName };
  }, [visibleGroups, visibleSideboardGroups, visibleConsideringGroups, rarityCorrections]);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Hover-peek for the list view — ROW-anchored (parks the card beside the row,
  // centered, stable) rather than cursor-anchored, so it never tracks the mouse
  // or floats over the row's ⋮ kebab. Gated to ≥1024px: the list is a dense CSS
  // multi-column flow, so only wide desktop has room beside it for a legible
  // (~200px) card without overlapping the columns. Tablet/phone (<1024px) skip
  // the peek and use the row's own thumbnail + click→carousel. No-op on
  // touch/native regardless.
  const hoverPeek = useDeckHoverPeek({ anchor: 'row', minViewport: 1024 });
  // Touch parity (E129): long-press a row for the same glance, at any
  // viewport width (there's no gutter-width gate — a phone has no gutter at
  // all, and `computePeekPlacement` already clamps into whatever room
  // exists). See `useTouchPeek` for the full gesture-coexistence contract.
  const touchPeek = useTouchPeek();
  const openPreview = (rowName: string) => {
    hoverPeek.clear(); // the carousel supersedes the transient peek
    touchPeek.clear();
    const i = flat.indexByName.get(rowName);
    if (i !== undefined) setPreviewIndex(i);
  };

  // Zone-aware qty (E175): bind the host's single `onSetQty(zone, card, qty,
  // opts)` to a specific zone for a given CategorySection instance, so a
  // sideboard/considering section's stepper can never reach mainboard.cards.
  // Preserves the existing "omitted prop → stepper doesn't render at all"
  // gate (CategorySection/DeckCardRow only render it when truthy).
  const onSetQtyForZone = (zone: DeckZone) =>
    onSetQty
      ? (card: ScryfallCard, qty: number, opts?: { relative?: boolean }) =>
          onSetQty(zone, card, qty, opts)
      : undefined;

  // Same zone-binding shape for reorder (E172) — CategorySection computes the
  // sortIndex itself and hands it here already resolved.
  const onReorderForZone = (zone: DeckZone) =>
    onReorder
      ? (slotIds: string[], sortIndex: number) => onReorder(zone, slotIds, sortIndex)
      : undefined;

  // New-arrivals header chip (E140) — shared renderer used by both the list
  // view's CategorySection headerAction slot (below) and the grid view's own
  // section header (DeckCardGrid, a sibling component — see renderArrivalsChip).
  const arrivalsChip = (bucket: TypeGroup) =>
    renderArrivalsChip(bucket, arrivalsByType, setOpenArrivalsBucket);

  // Tap a headline stat (cards / value) to drill into the cards behind it —
  // the same carousel pattern as the analysis-tab drill-downs. The missing
  // stat opens the buy-list dialog instead; its rows hand off to this
  // carousel one card at a time.
  const statCarousel = useCardCarousel(title);
  // Reopen the buy list when a carousel it spawned closes (the dialog and the
  // carousel never stack — Modal and CardPreview both grab Escape globally, so
  // layering them would close both on one keypress).
  const statCarouselOpen = statCarousel.preview !== null;
  useEffect(() => {
    if (!statCarouselOpen && buyListReturn.current) {
      buyListReturn.current = false;
      setBuyListOpen(true);
    }
  }, [statCarouselOpen]);

  // ── Role filter (pill bar) ──────────────────────────────────────────────
  // View-local transient lens over the automatic role classification (the
  // same source as the row badges). An active role keeps every row in place
  // but dims the rest, so matching cards pop without the layout reshuffling.
  const [roleFilter, setRoleFilter] = useState<RoleKey | null>(null);
  // Slots per top-level role across mainboard + sideboard — mirrors what the
  // lens dims. Multi-role cards count toward each role they fill.
  const roleFilterEntries = useMemo(() => {
    const counts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    if (taggerReady) {
      for (const dc of [...cards, ...sideboard]) {
        for (const role of cardFilterRoles(dc.card)) counts[role] += 1;
      }
    }
    return (Object.keys(ROLE_TITLES) as RoleKey[])
      .map((key) => [key, counts[key]] as const)
      .filter(([, count]) => count > 0);
  }, [cards, sideboard, taggerReady]);
  // Self-healing: if the active role's last card leaves the deck, deactivate
  // instead of dimming the whole list.
  const activeRoleFilter =
    roleFilter && roleFilterEntries.some(([key]) => key === roleFilter) ? roleFilter : null;

  // "Not in the deck" zone (E176): whether the format has a real sideboard
  // at all (every DECK_FORMAT_CONFIGS entry does today, but the format
  // config's own sideboardSize gate is the single source, mirrored from the
  // former list-view-only sideboard section). false → the switch collapses
  // to Considering alone (a 1-item tablist would be an anti-pattern).
  const showSideboardTab = formatConfig.sideboardSize > 0;

  const ctxValue = useMemo(
    () => ({
      openCard: () => {},
      openPages: () => {},
      isPreviewOpen: previewIndex !== null,
    }),
    [previewIndex]
  );

  return (
    <CardPreviewContext.Provider value={ctxValue}>
      <div
        className="deck-display"
        role="tabpanel"
        id={`deck-view-panel-${activeView}`}
        aria-labelledby={`sc-tab-${activeView}`}
      >
        {/* Root-level so the deck-complete moment plays from any view (a
            Coach apply on the Tune view can complete the deck too). */}
        {sealMoment}
        {/* `deck` view: the card-list editing surface (toolbar + banner + body).
            The analysis views (stats/power/tune) replace it full-width — the
            page-top hub tab bar in DeckEditorPage switches between them. */}
        {activeView === 'deck' ? (
          <>
            {/* High-level stats, glanceable while editing the list — these used
                to live behind the Overview analysis tab. Each reads as a metric:
                a bold value over a small muted label. Leads the surface (it used
                to sit below the toolbar): these describe the deck, the toolbar
                configures the list, and on a phone the toolbar's rows pushed the
                strip — the most useful thing here — under the fold. */}
            <div className="deck-stat-strip" aria-label="Deck stats">
              {deckTally.length > 0 ? (
                <button
                  type="button"
                  className="deck-stat deck-stat-btn"
                  onClick={() =>
                    void statCarousel.open(tallyToEntries(deckTally), deckTally[0]?.name ?? '')
                  }
                  aria-label={`Show all ${totalCards} cards in the deck`}
                >
                  <span className="deck-stat-value">{totalCards}</span>
                  <span className="deck-stat-label">cards</span>
                </button>
              ) : (
                <span className="deck-stat">
                  <span className="deck-stat-value">{totalCards}</span>
                  <span className="deck-stat-label">cards</span>
                </span>
              )}
              <span className="deck-stat">
                <span className="deck-stat-value">{manaData.averageCmc.toFixed(2)}</span>
                <span className="deck-stat-label">avg mana value</span>
              </span>
              {valueEntries.length > 0 ? (
                <button
                  type="button"
                  className="deck-stat deck-stat-btn"
                  onClick={() => void statCarousel.open(valueEntries, valueEntries[0]?.name ?? '')}
                  aria-label="Show the deck's cards sorted by price, most valuable first"
                >
                  <span className="deck-stat-value">{formatMoney(totalPrice, { currency })}</span>
                  <span className="deck-stat-label">value</span>
                </button>
              ) : (
                <span className="deck-stat">
                  <span className="deck-stat-value">{formatMoney(totalPrice, { currency })}</span>
                  <span className="deck-stat-label">value</span>
                </span>
              )}
              {identity && (
                <span className="deck-stat">
                  <span className="deck-stat-value">{identity.archetypeLabel}</span>
                  <span className="deck-stat-label">archetype</span>
                </span>
              )}
              {missing.count > 0 &&
                (missingTally.length > 0 ? (
                  <button
                    type="button"
                    className="deck-stat deck-stat-missing deck-stat-btn"
                    onClick={() => setBuyListOpen(true)}
                    aria-label={`Open the buy list for the ${missing.count} missing cards`}
                  >
                    <span className="deck-stat-value">{missing.count}</span>
                    <span className="deck-stat-label">
                      missing ({formatMoney(missing.price, { currency })})
                    </span>
                  </button>
                ) : (
                  <span className="deck-stat deck-stat-missing">
                    <span className="deck-stat-value">{missing.count}</span>
                    <span className="deck-stat-label">
                      missing ({formatMoney(missing.price, { currency })})
                    </span>
                  </span>
                ))}
            </div>
            {statCarousel.preview}

            <DeckToolbar
              title={title}
              sort={sort}
              sortDir={sortDir}
              onToggleSort={onToggleSort}
              search={search}
              onSearch={setSearch}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              groupBy={groupBy}
              onGroupByChange={handleGroupByChange}
              gridZoom={effectiveGridZoom}
              gridWidth={gridWidth}
              onGridZoomChange={handleGridZoomChange}
              isNarrowGrid={isNarrowGrid}
              showPrefs={showPrefs}
              onShowPrefsChange={handleShowPrefsChange}
              onExport={() => setExportOpen(true)}
              onShowTestHand={onShowTestHand}
              outzoneCount={sideboard.length + considering.length}
              canBulkEdit={canBulkEdit}
              selectMode={selectMode}
              onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            />

            {/* Bulk-action bar (E172) — replaces nothing, sits directly under
                the toolbar only while selecting. Actions are zone-contextual:
                which buttons render depends on which zone the current
                selection is in (mainboard/sideboard/considering each have a
                different legal destination set). */}
            {selectMode && (
              <div className="deck-bulk-bar" role="region" aria-label="Bulk actions">
                <span className="deck-bulk-count">
                  {selection
                    ? `${selection.keys.size} ${selection.keys.size === 1 ? 'card' : 'cards'} selected`
                    : 'Select cards…'}
                </span>
                {selection && onBulkMove && selection.zone === 'cards' && showSideboardTab && (
                  <button
                    type="button"
                    className="btn deck-bulk-btn"
                    onClick={() => {
                      onBulkMove([...selection.keys], 'cards', 'sideboard');
                      setSelection(null);
                    }}
                  >
                    Move to sideboard
                  </button>
                )}
                {selection && onBulkMove && selection.zone === 'cards' && (
                  <button
                    type="button"
                    className="btn deck-bulk-btn"
                    onClick={() => {
                      onBulkMove([...selection.keys], 'cards', 'considering');
                      setSelection(null);
                    }}
                  >
                    Move to considering
                  </button>
                )}
                {selection && onBulkMove && selection.zone !== 'cards' && (
                  <button
                    type="button"
                    className="btn deck-bulk-btn"
                    onClick={() => {
                      onBulkMove([...selection.keys], selection.zone, 'cards');
                      setSelection(null);
                    }}
                  >
                    Move to mainboard
                  </button>
                )}
                {selection && onBulkEditTag && (
                  <ToolbarPopover
                    label="Tag"
                    icon={<TagIcon width={14} height={14} strokeWidth={2} aria-hidden />}
                  >
                    {(close) => (
                      <BulkTagPopoverBody
                        existingTags={deckTags.map((t) => t.tag)}
                        onAdd={(tag) => {
                          onBulkEditTag(selection.zone, [...selection.keys], tag, true);
                          close();
                        }}
                        onRemove={(tag) => {
                          onBulkEditTag(selection.zone, [...selection.keys], tag, false);
                          close();
                        }}
                      />
                    )}
                  </ToolbarPopover>
                )}
                {selection && onBulkRemove && (
                  <button
                    type="button"
                    className="btn btn-danger deck-bulk-btn"
                    onClick={() => setConfirmBulkRemove(true)}
                  >
                    <Trash2 width={14} height={14} strokeWidth={2} aria-hidden />
                    Remove
                  </button>
                )}
                <button type="button" className="btn deck-bulk-done" onClick={exitSelectMode}>
                  Done
                </button>
              </div>
            )}

            {confirmBulkRemove && selection && onBulkRemove && (
              <ConfirmDialog
                title={`Remove ${selection.keys.size} ${selection.keys.size === 1 ? 'card' : 'cards'}?`}
                body="This removes the selected cards from the deck. You can undo it from the editor's undo history right after."
                confirmLabel="Remove"
                danger
                onConfirm={() => {
                  onBulkRemove(selection.zone, [...selection.keys]);
                  setSelection(null);
                  setConfirmBulkRemove(false);
                }}
                onCancel={() => setConfirmBulkRemove(false)}
              />
            )}

            {(flaggedCardCount > 0 || deckSizeWarning) && (
              <div className="deck-legality-banner">
                <CircleAlert width={16} height={16} strokeWidth={2} aria-hidden />
                {deckSizeWarning && <span>{deckSizeWarning}</span>}
                {deckSizeWarning && flaggedCardCount > 0 && <span aria-hidden>·</span>}
                {flaggedCardCount > 0 && (
                  <span>
                    {flaggedCardCount} {flaggedCardCount === 1 ? 'card' : 'cards'} flagged in{' '}
                    {formatConfig.label}
                  </span>
                )}
              </div>
            )}

            {onReviewShared && claimedElsewhereCount > 0 && (
              <div className="deck-claimed-banner">
                <Layers width={16} height={16} strokeWidth={2} aria-hidden />
                <span className="deck-claimed-banner-text">
                  {claimedElsewhereCount} {claimedElsewhereCount === 1 ? 'card' : 'cards'} here{' '}
                  {claimedElsewhereCount === 1 ? 'is' : 'are'} also in your other decks
                </span>
                <button
                  type="button"
                  className="btn btn-sm deck-claimed-banner-btn"
                  onClick={onReviewShared}
                >
                  Review
                </button>
              </div>
            )}

            {/* Role-filter bar — how the deck's roles balance, and a one-tap
                lens: an active role keeps every row in place but dims the rest,
                so matching cards pop without the layout reshuffling. */}
            {roleFilterEntries.length > 0 && (
              <div className="deck-role-bar" role="toolbar" aria-label="Role filter">
                {roleFilterEntries.map(([key, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={`deck-role-bar-chip${activeRoleFilter === key ? ' is-active' : ''}`}
                    aria-pressed={activeRoleFilter === key}
                    onClick={() => setRoleFilter((cur) => (cur === key ? null : key))}
                  >
                    {ROLE_TITLES[key]}
                    <span className="deck-role-bar-count">{count}</span>
                  </button>
                ))}
                {activeRoleFilter && (
                  <button
                    type="button"
                    className="deck-role-bar-clear"
                    onClick={() => setRoleFilter(null)}
                    aria-label={`Clear the ${ROLE_TITLES[activeRoleFilter]} role filter`}
                  >
                    <X width={12} height={12} strokeWidth={2.2} aria-hidden />
                    Clear
                  </button>
                )}
                <InfoTip
                  label="role filter"
                  text={
                    <p className="info-tip-lead">
                      Automatic role classification — the same read as the row badges. Tap a chip to
                      spotlight those cards; tap it again to clear.
                    </p>
                  }
                />
              </div>
            )}

            {/* Overlap-honesty note (E171): grouping by tag is NOT a partition
                — a card with 2 tags shows up in both groups, so summing the
                section counts below overstates the deck. The stat strip's
                card count (computed straight from the raw lists, never from
                these groups) is the only number that's ever a total. */}
            {groupBy === 'tag' && (
              <div className="deck-tag-honesty-banner">
                <TagIcon width={14} height={14} strokeWidth={2} aria-hidden />
                <span>
                  Tags can overlap — a multi-tagged card appears in every group it's tagged with.
                  The card count above is always the true deck size.
                </span>
                {deckTags.length > 0 && (onRenameDeckTag || onRemoveDeckTag) && (
                  <ToolbarPopover
                    triggerClassName="btn btn-sm deck-tag-manage-btn"
                    triggerContent="Manage tags"
                    triggerAriaLabel="Manage deck tags"
                    panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed deck-tag-manager-popover"
                    panelAriaLabel="Manage tags"
                  >
                    {(close) => (
                      <DeckTagManager
                        tags={deckTags}
                        onRename={onRenameDeckTag}
                        onRemove={onRemoveDeckTag}
                        onDone={close}
                      />
                    )}
                  </ToolbarPopover>
                )}
              </div>
            )}

            <div className="deck-display-body">
              <div className="deck-display-main">
                {/* E182: a brand-new deck (no commander, no cards) previously
                    rendered a fully interactive toolbar over a blank
                    .deck-card-list — this is the manual builder's first
                    impression, so it needs its own state rather than empty
                    space. Reuses the insight-strip idiom (one row,
                    --surface-raised) instead of a bespoke illustration.
                    Commander-format decks with no commander yet get distinct
                    copy — everything downstream (suggestions, identity)
                    depends on the commander, so that's the actual next step. */}
                {visibleGroups.length === 0 && (
                  <div className="deck-empty-state">
                    <span className="deck-empty-state-icon" aria-hidden>
                      <Search width={18} height={18} strokeWidth={2} />
                    </span>
                    <div className="deck-empty-state-body">
                      {formatConfig.hasCommander && !commander ? (
                        <>
                          <p className="deck-empty-state-headline">
                            This deck needs a commander first.
                          </p>
                          <p className="deck-empty-state-detail">
                            Suggestions, color identity, and legality all follow your commander —
                            add one to get started.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="deck-empty-state-headline">This deck is empty.</p>
                          <p className="deck-empty-state-detail">
                            Open Add cards to search for cards and start your list.
                          </p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary deck-empty-state-action"
                      onClick={() => onAddCards?.()}
                    >
                      {formatConfig.hasCommander && !commander ? 'Choose a commander' : 'Add cards'}
                    </button>
                  </div>
                )}
                {viewMode === 'list' && visibleGroups.length > 0 && (
                  <div
                    className="deck-card-list"
                    {...hoverPeek.listHandlers}
                    {...touchPeek.listHandlers}
                  >
                    {visibleGroups.map((g) => (
                      <CategorySection
                        key={g.title}
                        title={g.title}
                        icon={g.icon}
                        rows={g.rows}
                        target={g.target}
                        currency={currency}
                        showPrefs={showPrefs}
                        onRowClick={openPreview}
                        onRemoveCard={onRemoveCard}
                        onSetQty={onSetQtyForZone('cards')}
                        selectMode={selectMode}
                        isRowSelected={(row) => isRowSelected('cards', row)}
                        onToggleRowSelected={(row) => toggleRowSelected('cards', row)}
                        dragEnabled={sort === 'custom'}
                        onReorder={onReorderForZone('cards')}
                        isSingleton={formatConfig.isSingleton}
                        onEditCard={onEditCard}
                        roleFilter={activeRoleFilter}
                        legalityBySlot={legalityBySlot}
                        onMoveToSideboard={showSideboardTab ? onMoveToSideboard : undefined}
                        onMoveToConsidering={onMoveToConsidering}
                        onMakeCommander={onMakeCommander}
                        canMakeCommander={canMakeCommander}
                        onMakePartner={onMakePartner}
                        canMakePartner={canMakePartner}
                        onMoveToAnotherDeck={onMoveToAnotherDeck}
                        onReleaseCopy={onReleaseCopy}
                        onUseOwnCopy={onUseOwnCopy}
                        headerAction={
                          g.icon === 'commander' && onEditPartner ? (
                            <PartnerHeaderButton
                              hasPartner={!!partnerCommander}
                              onClick={onEditPartner}
                            />
                          ) : g.icon === 'commander' ? undefined : (
                            arrivalsChip(g.title as TypeGroup)
                          )
                        }
                        synergyByName={synergyByName}
                        cardInclusionMap={cardInclusionMap}
                        combosByOracle={combosByOracle}
                        cardProvenance={cardProvenance}
                      />
                    ))}
                  </div>
                )}
                {viewMode === 'grid' && visibleGroups.length > 0 && (
                  <DeckCardGrid
                    groups={visibleGroups}
                    onRowClick={openPreview}
                    legalityBySlot={legalityBySlot}
                    gridZoom={effectiveGridZoom}
                    gridRef={gridRef}
                    gridWidth={gridWidth}
                    showRoles={showPrefs.roles}
                    roleFilter={activeRoleFilter}
                    synergyByName={synergyByName}
                    binderByCopyId={binderByCopyId}
                    hasPartner={!!partnerCommander}
                    onEditPartner={onEditPartner}
                    arrivalsByType={arrivalsByType}
                    onOpenArrivals={setOpenArrivalsBucket}
                  />
                )}

                {/* "Not in the deck" (E176) — one subordinate zone below the
                    decklist, in EVERY view mode (the former defect: this
                    content only rendered inside the list-view branch, so
                    grid-view users could neither see nor reach it). Always a
                    compact row list (CategorySection/DeckCardRow) even in
                    grid view — it's a small holding zone, not a shape story,
                    so thumbnails would waste vertical space. The Sideboard
                    tab is format-gated (unlimited/constructed sideboards);
                    Considering (E122) is always available and always
                    excluded from stats/legality/mana/role counts upstream
                    (see the `cards`-only `allCards`/`legalityIssues` memos
                    above — this zone never feeds them). */}
                <div className="deck-outzone">
                  <h3 className="deck-outzone-title" id="deck-outzone" tabIndex={-1}>
                    Not in the deck
                  </h3>
                  {showSideboardTab ? (
                    <Tabs
                      ariaLabel="Not in the deck"
                      variant="fitted"
                      value={outzoneTab}
                      onChange={setOutzoneTab}
                      tabs={[
                        {
                          id: 'sideboard',
                          label: 'Sideboard',
                          count: sideboard.length,
                          controls: 'deck-outzone-panel',
                          ariaLabel: `Sideboard, ${sideboard.length} cards`,
                        },
                        {
                          id: 'considering',
                          label: 'Considering',
                          count: considering.length,
                          controls: 'deck-outzone-panel',
                          ariaLabel: `Considering, ${considering.length} cards`,
                        },
                      ]}
                    />
                  ) : (
                    <div className="deck-outzone-single-label">
                      Considering
                      <span className="deck-outzone-single-count">({considering.length})</span>
                    </div>
                  )}
                  <div
                    id="deck-outzone-panel"
                    className="deck-outzone-body"
                    role={showSideboardTab ? 'tabpanel' : undefined}
                    aria-labelledby={showSideboardTab ? `sc-tab-${outzoneTab}` : undefined}
                  >
                    {outzoneTab === 'sideboard' && showSideboardTab ? (
                      visibleSideboardGroups.length > 0 ? (
                        visibleSideboardGroups.map((g) => (
                          <CategorySection
                            key={`sb-${g.title}`}
                            title={g.title}
                            icon={g.icon}
                            rows={g.rows}
                            currency={currency}
                            showPrefs={showPrefs}
                            onRowClick={openPreview}
                            onRemoveCard={onRemoveSideboardCard}
                            onSetQty={onSetQtyForZone('sideboard')}
                            selectMode={selectMode}
                            isRowSelected={(row) => isRowSelected('sideboard', row)}
                            onToggleRowSelected={(row) => toggleRowSelected('sideboard', row)}
                            dragEnabled={sort === 'custom'}
                            onReorder={onReorderForZone('sideboard')}
                            isSingleton={formatConfig.isSingleton}
                            onEditCard={onEditCard}
                            roleFilter={activeRoleFilter}
                            legalityBySlot={legalityBySlot}
                            onMoveToMainboard={onMoveToMainboard}
                            onMakeCommander={onMakeCommander}
                            canMakeCommander={canMakeCommander}
                            onMakePartner={onMakePartner}
                            canMakePartner={canMakePartner}
                            onMoveToAnotherDeck={onMoveToAnotherDeck}
                            onReleaseCopy={onReleaseCopy}
                            onUseOwnCopy={onUseOwnCopy}
                            synergyByName={synergyByName}
                            cardInclusionMap={cardInclusionMap}
                            combosByOracle={combosByOracle}
                            cardProvenance={cardProvenance}
                          />
                        ))
                      ) : (
                        <p className="deck-outzone-empty">No sideboard cards yet</p>
                      )
                    ) : visibleConsideringGroups.length > 0 ? (
                      visibleConsideringGroups.map((g) => (
                        <CategorySection
                          key={`cn-${g.title}`}
                          title={g.title}
                          icon={g.icon}
                          rows={g.rows}
                          currency={currency}
                          showPrefs={showPrefs}
                          onRowClick={openPreview}
                          onRemoveCard={onRemoveConsideringCard}
                          onSetQty={onSetQtyForZone('considering')}
                          selectMode={selectMode}
                          isRowSelected={(row) => isRowSelected('considering', row)}
                          onToggleRowSelected={(row) => toggleRowSelected('considering', row)}
                          dragEnabled={sort === 'custom'}
                          onReorder={onReorderForZone('considering')}
                          // Considering is copy-limit exempt (E122) regardless of
                          // format singleton rules — never the artificial 1-copy
                          // cap `isSingleton ?? true` would otherwise fall back to.
                          isSingleton={false}
                          roleFilter={activeRoleFilter}
                          onMoveToMainboard={onMoveFromConsidering}
                          synergyByName={synergyByName}
                          cardInclusionMap={cardInclusionMap}
                          combosByOracle={combosByOracle}
                          cardProvenance={cardProvenance}
                        />
                      ))
                    ) : (
                      <p className="deck-outzone-empty">
                        Nothing parked here yet — cards you're unsure about land here from import,
                        suggestions, or "Move to considering" on any card.
                      </p>
                    )}
                  </div>
                </div>

                {onAddFromSearch && search.trim().length >= 1 && noDeckMatches && (
                  <button
                    type="button"
                    className="deck-display-scryfall-trigger"
                    onClick={() => onAddFromSearch(search.trim())}
                    aria-label={`Search Scryfall for ${search.trim()} to add a card not in this deck`}
                  >
                    <Search width={16} height={16} strokeWidth={1.8} aria-hidden />
                    <span className="deck-display-scryfall-trigger-text">
                      <span className="deck-display-scryfall-trigger-title">Search Scryfall</span>
                      <span className="deck-display-scryfall-trigger-sub">
                        for "{search.trim()}" — add a card not in this deck
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <DeckAnalysisView
            view={activeView}
            allCards={allCards}
            manaData={manaData}
            bracketEstimation={bracketEstimation}
            deckCardsByName={deckCardsByName}
            bracketOverride={bracketOverride}
            onSetBracketOverride={onSetBracketOverride}
            archetypeOverride={archetypeOverride}
            onSetArchetypeOverride={onSetArchetypeOverride}
            roleCounts={roleCounts}
            roleTargets={roleTargets}
            buildReport={buildReport}
            rampSubtypeCounts={rampSubtypeCounts}
            removalSubtypeCounts={removalSubtypeCounts}
            boardwipeSubtypeCounts={boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={cardDrawSubtypeCounts}
            averageSalt={averageSalt}
            saltiestCards={saltiestCards}
            planScore={planScore}
            edhrecNumDecks={edhrecNumDecks}
            combosSlot={combosSlot}
            coachFeedSlot={coachFeedSlot}
            engineSlot={engineSlot}
            winConditionSlot={winConditionSlot}
            powerHeroSlot={powerHeroSlot}
            tableRecordSlot={tableRecordSlot}
            aiReviewSlot={aiReviewSlot}
            derivedRoles={derivedRoles}
            validation={validation}
            analysisState={analysisState}
            onNavigateToTune={onNavigateToTune}
            onRetryAnalysis={onRetryAnalysis}
            commander={commander}
            partnerCommander={partnerCommander}
            deckName={title}
            format={format}
            deckColor={color ?? 'var(--accent)'}
            identity={identity}
            scoreRevealKey={scoreRevealKey}
            onAddSuggestedCard={onAddSuggestedCard}
            addingSuggestedCardNames={addingSuggestedCardNames}
            oneAwayCombos={oneAwayCombos}
            ownedOracleIds={ownedOracleIds}
            landUpgradeCount={landUpgradeCount}
          />
        )}

        {/* Desktop-only floating hover-peek: a transient card-art preview in the
            gutter beside the list while hovering a row. No-op on touch/native. */}
        {hoverPeek.peek &&
          (() => {
            // A printing sub-row carries its own art (data-peek-img); use it so
            // each expanded printing peeks its real card. Otherwise resolve the
            // hovered card's hero art by name from the same flat list the
            // carousel uses, so the peek matches the owned printing.
            const i = flat.indexByName.get(hoverPeek.peek.name);
            const card = i !== undefined ? flat.cards[i] : undefined;
            return (
              <DeckHoverPeek
                imageUrl={hoverPeek.peek.img || card?.imageLarge || card?.imageNormal}
                left={hoverPeek.peek.left}
                top={hoverPeek.peek.top}
                width={hoverPeek.peek.width}
              />
            );
          })()}

        {/* Touch long-press peek (E129) — same art resolution as the hover
            peek above; portaled to <body> so it can't get trapped by a
            `container-type`/transform ancestor. */}
        {touchPeek.peek &&
          (() => {
            const i = flat.indexByName.get(touchPeek.peek.name);
            const card = i !== undefined ? flat.cards[i] : undefined;
            return createPortal(
              <DeckHoverPeek
                variant="touch"
                imageUrl={touchPeek.peek.img || card?.imageLarge || card?.imageNormal}
                left={touchPeek.peek.left}
                top={touchPeek.peek.top}
                width={touchPeek.peek.width}
              />,
              document.body
            );
          })()}

        {previewIndex !== null && (
          <CardPreview
            source="deck"
            cards={flat.cards}
            sectionLabels={flat.labels}
            pageNumbers={flat.cards.map(() => 0)}
            totalPages={1}
            binderName={title}
            currentDeckId={deckId}
            index={previewIndex}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
            renderPanelMeta={(i) => {
              const r = flat.rows[i];
              if (!r) return null;
              // Commander/partner rows have no deck slot (r.slotIds is empty) —
              // nothing to tag, so the editor stays off; existing tags (there
              // never are any) still display via `tags` if that ever changes.
              const canEditTags = !!onSetCardTags && r.slotIds.length > 0;
              return (
                <DeckCardPreviewMeta
                  card={r.card}
                  isPartner={r.isPartner}
                  isCommander={!r.isPartner && commander?.name === r.name}
                  synergies={synergyByName?.get(r.name)}
                  inclusionPct={resolveInclusionPct(cardInclusionMap, r)}
                  legality={
                    (r.legalitySlotKey ?? r.slotIds[0])
                      ? legalityBySlot.get(r.legalitySlotKey ?? r.slotIds[0])
                      : undefined
                  }
                  status={r.status}
                  tags={r.tags}
                  tagsEdited={r.tagsEdited}
                  suggestedTag={!r.tagsEdited ? suggestedTagForCard(r.card) : null}
                  existingDeckTags={deckTags.map((t) => t.tag)}
                  onSetTags={
                    canEditTags
                      ? (tags) => onSetCardTags!(flat.zones[i], r.slotIds, tags)
                      : undefined
                  }
                />
              );
            }}
            renderPanelExtra={(i) => {
              // In-context "Swap this card" + "Similar cards": offered only for a
              // real in-deck card (commander/partner rows carry no slotId, so
              // they're excluded).
              const r = flat.rows[i];
              if (!r) return null;
              const slotId = r.slotIds[r.slotIds.length - 1];
              if (!slotId) return null;
              const close = () => setPreviewIndex(null);
              return (
                <>
                  {renderSwapSuggestions?.(r.card, slotId, close)}
                  {renderSimilarCards?.(r.card, slotId, close)}
                </>
              );
            }}
            getStackBinders={(i) => {
              const r = flat.rows[i];
              if (!r || !binderByCopyId) return [];
              const seen = new Set<string>();
              const out: BinderInfo[] = [];
              for (const cid of r.allocatedCopyIds) {
                for (const b of binderByCopyId.get(cid) ?? []) {
                  if (!seen.has(b.id)) {
                    seen.add(b.id);
                    out.push(b);
                  }
                }
              }
              return out;
            }}
            getStackAllocations={(i) => {
              const r = flat.rows[i];
              if (!r || !crossDeck.otherDeckAllocations) return [];
              const seen = new Set<string>();
              const out: AllocationInfo[] = [];
              for (const cid of r.allocatedCopyIds) {
                const a = crossDeck.otherDeckAllocations.get(cid);
                // Dedupe on ownerId, not the legacy deckId alias — every cube
                // claim shares deckId='' and would otherwise collapse to one.
                if (a && !seen.has(a.ownerId)) {
                  seen.add(a.ownerId);
                  out.push(a);
                }
              }
              return out;
            }}
            getActions={(i) => {
              const r = flat.rows[i];
              if (!r) return [];
              const acts: CardPreviewAction[] = [];
              const slotId = r.slotIds[0];
              if (onEditCard && slotId) {
                acts.push({
                  key: 'edit',
                  label: 'Edit',
                  icon: <Pencil width={18} height={18} strokeWidth={2} aria-hidden />,
                  onClick: () => {
                    setPreviewIndex(null);
                    onEditCard(slotId, r.card);
                  },
                });
              }
              if (onRemoveCard && r.slotIds.length > 0) {
                acts.push({
                  key: 'delete',
                  label: 'Delete',
                  danger: true,
                  icon: <Trash2 width={18} height={18} strokeWidth={2} aria-hidden />,
                  onClick: () => {
                    setPreviewIndex(null);
                    onRemoveCard(r.slotIds[r.slotIds.length - 1]);
                  },
                });
              }
              return acts;
            }}
          />
        )}
        {buyListOpen && (
          <BuyListDialog
            tally={missingTally}
            currency={currency}
            title={title}
            onClose={() => setBuyListOpen(false)}
            onPickCard={(name) => {
              setBuyListOpen(false);
              buyListReturn.current = true;
              void statCarousel.open(tallyToEntries(missingTally), name);
            }}
          />
        )}
        {openArrivalsBucket && (
          <NewArrivalsSheet
            bucket={openArrivalsBucket}
            rows={arrivalsByType?.[openArrivalsBucket] ?? []}
            onClose={() => setOpenArrivalsBucket(null)}
            onMarkReviewed={() => onMarkArrivalsReviewed?.()}
            onAddCard={onAddSuggestedCard}
            addingCardNames={addingSuggestedCardNames}
            existingCardCounts={existingCardCounts}
            ownershipFor={ownershipFor}
          />
        )}
        {exportOpen && (
          <DeckExportDialog
            text={exportText}
            format={exportFormat}
            onFormatChange={handleExportFormatChange}
            title={title}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </CardPreviewContext.Provider>
  );
}

// Bulk-tag popover body (E172) — a text input to add a new tag to the whole
// selection, plus the deck's existing tags as one-tap chips (add). There's no
// per-selected-card "which of these already has it" reconciliation here —
// bulkEditTag's add/remove is idempotent per slot either way, so offering
// every deck tag as an "add" chip is always safe, just sometimes a no-op for
// cards that already carry it.
function BulkTagPopoverBody({
  existingTags,
  onAdd,
  onRemove,
}: {
  existingTags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const tag = draft.trim();
    if (tag) onAdd(tag);
    setDraft('');
  };
  return (
    <div className="deck-bulk-tag-popover">
      <div className="deck-bulk-tag-input-row">
        <input
          type="text"
          className="deck-bulk-tag-input"
          placeholder="New tag…"
          value={draft}
          maxLength={40}
          aria-label="New tag name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" className="btn btn-primary deck-bulk-tag-add" onClick={commit}>
          Add
        </button>
      </div>
      {existingTags.length > 0 && (
        <ul className="deck-bulk-tag-chip-list" aria-label="Existing tags">
          {existingTags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="deck-bulk-tag-chip"
                onClick={() => onAdd(tag)}
                title={`Add "${tag}" to selection`}
              >
                {tag}
              </button>
              <button
                type="button"
                className="deck-bulk-tag-chip-remove"
                onClick={() => onRemove(tag)}
                aria-label={`Remove "${tag}" from selection`}
                title={`Remove "${tag}" from selection`}
              >
                <X width={11} height={11} strokeWidth={2.4} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Analysis views ─────────────────────────────────────────────────────────
/** The page-top analysis view ids. (Test hand is a separate standalone panel,
 *  not a view — goldfishing is a distinct activity.) */
export type AnalysisTabId = 'stats' | 'power' | 'tune';

/** The full page-top view set: the card-list editing surface plus the analysis
 *  views. `DeckEditorPage` owns this state and renders the hub tab bar. */
export type DeckView = 'deck' | AnalysisTabId;
