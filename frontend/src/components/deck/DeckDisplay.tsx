import { CircleAlert, Layers, Search } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useOverflowEdges } from '@/lib/util/use-overflow-edges';
import { useCurrency } from '@/lib/collection/currency';
import { isKeyboardContextMenu, keepsBrowserMenu } from '@/lib/overlays/context-menu';
import { createPortal } from 'react-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { collectDeckTags } from '@/lib/deck/deck-tags';
import { DeckTagManager } from './DeckTagManager';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { buildManaData } from '@/lib/deck-analysis/build-mana-data';
import { useProducedMana } from './use-produced-mana';
import { useBanList } from '@/lib/deck/use-ban-list';
import { scrollToHeading } from '@/lib/util/scroll-to-heading';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  validateDeckSize,
  validateSideboardSize,
  sideboardLimit,
  countFlaggedCards,
  type LegalityIssue,
} from '@/lib/deck/deck-validation';
import { DeckExportDialog } from '../shared/DeckExportDialog';
import {
  buildExport,
  readStoredExportFormat,
  writeStoredExportFormat,
  type ExportFormat,
} from '@/lib/import-export/deck-export';
import type { DeckZone } from '../../store/decks';
import { CardPreview } from '@/components/card/CardPreview';
import { CardPreviewContext } from '@/components/binder/CardPreviewContext';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';
import { BuyListDialog } from './BuyListDialog';
import { DeckHoverPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useTouchPeek } from '@/lib/overlays/use-touch-peek';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';

import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { useRarityCorrections } from '@/lib/deck/use-rarity-corrections';
import { useCardCarousel, tallyToEntries } from './useCardCarousel';
import { NewArrivalsSheet } from './NewArrivalsSheet';
import { CommanderOpenSlot } from './CommanderOpenSlot';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  buildValidationChecklist,
  summarizeValidation,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import {
  deriveDeckIdentity,
  resolveAutoArchetype,
} from '@/deck-builder/services/deckBuilder/deckIdentity';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { ROLE_TITLES, type RoleKey } from '@/lib/deck-analysis/role-badges';
import { clampZoom, readStoredZoom } from '@/lib/util/grid-zoom';
import { useElementWidth } from '@/lib/util/use-element-width';
import { useMediaQuery } from '@/lib/util/use-media-query';

import { ToolbarPopover } from '../shared/ToolbarPopover';
import {
  resolveInclusionPct,
  readStoredViewMode,
  readStoredCollapsedSections,
  writeStoredCollapsedSections,
  readStoredShowPrefs,
  readStoredGroupBy,
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
  type TypedGroup,
  packSections,
  listColumnCount,
  sectionRowCount,
} from './deck-display-rows';
import { withViewerOwnership } from './viewer-ownership';
import { DeckCardInspector, type DeckCardInspectorCard } from './DeckCardInspector';
import { PartnerHeaderButton } from './deck-display-icons';
import { DeckToolbar } from './DeckToolbar';
import { DeckCardGrid } from './DeckCardGrid';
import { CategorySection } from './DeckMainboardRow';
import { DeckCardMenu } from './DeckCardMenu';
import { DeckSelectionMenu, type DeckBulkAction } from './DeckSelectionMenu';
import { hasCardActions, type DeckCardActionCtx } from './deck-card-actions';
import { DeckAnalysisView } from './DeckAnalysisView';
import { CardName } from '@/components/shared/CardName';
import { Button, buttonClass } from '@/components/shared/Button';
import type { DeckDisplayProps, AnalysisTabId, DeckView } from './deck-display-types';
import {
  titlesUnder,
  buildCrossDeckCtx,
  buildCommanderRows,
  validateDisplayedZones,
  buildSynergyByName,
  summarizeMissing,
  countClaimedElsewhere,
  buildMissingTally,
  buildFlatIndex,
  buildInspectorCard,
  bindersForRow,
  allocationsForRow,
} from './deck-display-derive';
import { buildCardMenuCtx, buildBulkActions, buildPreviewActions } from './deck-display-actions';
import { useDeckCompleteMoment } from './use-deck-complete-moment';
import { DeckStatStrip, DeckBulkBar, DeckRoleBar, DeckEmptyState } from './DeckDisplayBands';

const GRID_SIZE_STORAGE_KEY = 'mtg-decks-grid-size';
// The card inspector (DeckCardInspector) is the desktop card preview: any
// window ≥1024px with a fine pointer. It used to wait for 1440px, and between
// 1024 and 1439 a floating hover-peek stood in. That band has no gutter (the
// list spans the page), so the peek clamped to the viewport's left edge, right
// over the card names it was previewing. The list measures its own width, so
// beside the panel it drops to fewer columns. Below 1024 (or on a coarse
// pointer) the row thumbnail, click→carousel and touch long-press peek carry it.
const INSPECTOR_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

// Props and view ids live in ./deck-display-types; re-exported so every
// importer of this module keeps its path.
export type {
  DeckDisplayCard,
  DeckDisplayProps,
  AnalysisTabId,
  DeckView,
} from './deck-display-types';

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  deckId,
  format = 'commander',
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
  bracketMissesCombos,
  onSetBracketOverride,
  clockLibrary,
  bracketTableSlot,
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
  onChangeCommander,
  cover,
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
  tabbed = true,
  onShowTestHand,
  editActions,
  deckActionsInHeader,
  onAddCards,
  onChooseCommander,
  analysisState = 'ready',
  onNavigateToTune,
  onRetryAnalysis,
  edhrecMissing,
  scoreRevealKey,
  onAddSuggestedCard,
  openSlots,
  onFill,
  addingSuggestedCardNames,
  oneAwayCombos,
  ownedOracleIds,
  landUpgradeCount,
  arrivalsByType,
  existingCardCounts,
  ownershipFor,
  viewerMissing,
  onMarkArrivalsReviewed,
  autoOpenArrivals,
  onSetCardTags,
  onRenameDeckTag,
  onRemoveDeckTag,
  onBulkRemove,
  onBulkMove,
  onBulkEditTag,
  onReorder,
}: DeckDisplayProps) {
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  // The format has a command zone and it's empty, and this host can fill it
  // (E465). Drives the open-slot row and the empty state's second door.
  const chooseCommander = formatConfig.hasCommander && !commander ? onChooseCommander : undefined;
  const currency: CurrencyCode = useCurrency();
  // New-arrivals review (E140): whether the (single, all-category) sheet is open.
  const [arrivalsOpen, setArrivalsOpen] = useState(false);
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
  // Collapsed sections. Mainboard sections are keyed by lens so the same title
  // under two lenses folds independently; Sideboard and Considering are keyed
  // under `outzone:` because they are the same two piles under every lens.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    readStoredCollapsedSections
  );
  const sectionKey = (title: string) => `${groupBy}:${title}`;
  const isSectionCollapsed = (title: string) => collapsedSections.has(sectionKey(title));
  const toggleCollapsedKey = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      writeStoredCollapsedSections(next);
      return next;
    });
  };
  const toggleSection = (title: string) => toggleCollapsedKey(sectionKey(title));
  const toggleOutzoneSection = (title: string) => toggleCollapsedKey(`outzone:${title}`);
  // The card menu, anchored to a pointer or to a tile's kebab. One instance
  // for the whole surface; the row and tile only report where and what.
  const [cardMenu, setCardMenu] = useState<{
    row: Row;
    zone: DeckZone;
    x: number;
    y: number;
    /** The row or tile the menu acts on; it wears the ring while it's open. */
    target: Element | null;
  } | null>(null);
  // A right-click on a card that is part of a larger selection opens the
  // selection's actions instead of the card's (T162, the playtest rule).
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    target: Element | null;
  } | null>(null);
  const openCardMenu = (zone: DeckZone) => (row: Row, e: React.MouseEvent) => {
    // A field, selected text, a link or a Shift+right-click keeps the
    // browser's own menu (lib/overlays/context-menu), and so does a card with nothing
    // to do (a read-only shared deck).
    if (keepsBrowserMenu(e.nativeEvent)) return;
    if (
      selectMode &&
      selection &&
      isRowSelected(zone, row) &&
      selection.keys.size > row.slotIds.length
    ) {
      e.preventDefault();
      const target = e.currentTarget;
      const kebab = target.querySelector('.deck-card-grid-menu, .deck-row-menu-trigger');
      const rect = (kebab ?? target).getBoundingClientRect();
      const at = isKeyboardContextMenu(e.nativeEvent)
        ? { x: rect.left, y: rect.bottom }
        : { x: e.clientX, y: e.clientY };
      setSelectionMenu({ ...at, target });
      return;
    }
    if (!hasCardActions(cardMenuCtx(row, zone))) return;
    e.preventDefault();
    const target = e.currentTarget;
    if (isKeyboardContextMenu(e.nativeEvent)) {
      // The Context Menu key or Shift+F10 has no pointer: the menu opens where
      // the card's ⋮ opens it, beside the card rather than over its face.
      const kebab = target.querySelector('.deck-card-grid-menu, .deck-row-menu-trigger');
      const rect = (kebab ?? target).getBoundingClientRect();
      setCardMenu({ row, zone, x: rect.left, y: rect.bottom, target });
      return;
    }
    setCardMenu({ row, zone, x: e.clientX, y: e.clientY, target });
  };
  const openCardMenuAt = (zone: DeckZone) => (row: Row, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    setCardMenu({ row, zone, x: rect.left, y: rect.bottom, target: trigger.closest('li') });
  };

  const collapsedTitlesForLens = useMemo(
    () => titlesUnder(collapsedSections, `${groupBy}:`),
    [collapsedSections, groupBy]
  );
  const collapsedOutzoneTitles = useMemo(
    () => titlesUnder(collapsedSections, 'outzone:'),
    [collapsedSections]
  );
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
  // steps that wouldn't change the column count at this size. In the grid
  // view that is the whole grid (every group sits on its shared columns); in
  // stacks, a stack's own list. DeckCardGrid attaches it to the right element.
  const [gridRef, gridWidth] = useElementWidth<HTMLElement>();

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
  const crossDeck: CrossDeckCtx = useMemo(
    () => buildCrossDeckCtx(collectionByCopyId, allDecks, savedCubes, deckId),
    [collectionByCopyId, allDecks, savedCubes, deckId]
  );

  const claimedByForName = useCallback(
    (cardName: string) => findClaimedBy(cardName, crossDeck),
    [crossDeck]
  );

  // A deck shown without the viewer's collection (someone else's shared deck)
  // has no allocations, so ownership comes from the viewer's name-level lens.
  const viewerOwned = useMemo(
    () =>
      !collectionByCopyId && ownershipFor
        ? (name: string) => ownershipFor(name) === 'owned'
        : undefined,
    [collectionByCopyId, ownershipFor]
  );
  const rowsFor = useCallback(
    (zone: typeof cards) => {
      const rows = buildRows(zone, currency, collectionByCopyId, crossDeck);
      return viewerOwned ? withViewerOwnership(rows, viewerOwned) : rows;
    },
    [currency, collectionByCopyId, crossDeck, viewerOwned]
  );

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    const rows = buildCommanderRows({
      commander,
      partnerCommander,
      commanderAllocatedCopyId,
      partnerCommanderAllocatedCopyId,
      collectionByCopyId,
      crossDeck,
      claimedByForName,
      currency,
    });
    return viewerOwned ? withViewerOwnership(rows, viewerOwned) : rows;
  }, [
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
    crossDeck,
    claimedByForName,
    currency,
    viewerOwned,
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
    const rows = rowsFor(cards);
    if (groupBy === 'tag') return groupByTag(rows, commanderRows);
    return groupBy === 'category'
      ? groupByCategory(rows, categoryTargets, commanderRows)
      : groupByType(rows, commanderRows);
  }, [cards, commanderRows, rowsFor, groupBy, categoryTargets, taggerReady]);

  // Every distinct user tag across the WHOLE deck (all 3 zones, unfiltered
  // by search/groupBy) — the tag manager's "see all tags" list. Deliberately
  // independent of `visibleGroups` so it's stable while searching/grouping.
  const deckTags = useMemo(
    () => collectDeckTags({ cards, sideboard, considering }),
    [cards, sideboard, considering]
  );

  // The sideboard and Considering (E122) are each ONE section, whatever the
  // mainboard's lens: a pile of a handful of cards split by type would put a
  // header over every second card. Each renders the way the deck above it
  // does (tiles, a stack or rows), so the pile reads as more of the same deck
  // rather than a form bolted under it. `empty` is set only when the pile
  // really is empty; a search that filters it to nothing hides it like any
  // other section, instead of claiming there are no cards.
  const sideboardGroups = useMemo<TypedGroup[]>(
    () => [
      {
        title: 'Sideboard',
        icon: 'sideboard',
        rows: rowsFor(sideboard),
        empty: sideboard.length === 0 ? 'No sideboard cards yet' : undefined,
      },
    ],
    [sideboard, rowsFor]
  );
  const consideringGroups = useMemo<TypedGroup[]>(
    () => [
      {
        title: 'Considering',
        icon: 'considering',
        rows: rowsFor(considering),
        empty:
          considering.length === 0
            ? "Nothing parked here yet. Move a card here when you're unsure about it."
            : undefined,
      },
    ],
    [considering, rowsFor]
  );

  // Legality issues for the current format. The live ban list catches a card
  // banned after it was added, which its own stored legalities still call legal.
  // `legalityIssues` is what the deck is judged on: in Commander that is the
  // commander and the mainboard, never the sideboard, so an illegal card or a
  // second copy parked there can't fail the checks, set the Power tab's
  // "can't be played" note, inflate the flagged count or badge a mainboard
  // row. Sideboard rows still get their own badge (`sideboardIssues`).
  const bannedNames = useBanList(formatConfig.legalityKey);
  const { deck: legalityIssues, sideboardOnly: sideboardIssues } = useMemo(
    () =>
      validateDisplayedZones({
        cards,
        sideboard,
        formatConfig,
        commander,
        partnerCommander,
        bannedNames,
      }),
    [cards, sideboard, formatConfig, commander, partnerCommander, bannedNames]
  );

  const illegalCardNames = useMemo(
    () => [
      ...new Set(legalityIssues.filter((i) => i.issue === 'not-legal').map((i) => i.cardName)),
    ],
    [legalityIssues]
  );

  const legalityBySlot = useMemo(() => {
    const map = new Map<string, LegalityIssue>();
    for (const issue of [...legalityIssues, ...sideboardIssues]) {
      // Prefer the more specific issue type if multiple apply to the same slot.
      // Color-identity and not-legal both signal "this card does not belong";
      // copy-limit is a separate flavor. Keep whichever we saw first since the
      // tooltip only has room for one detail line anyway.
      if (!map.has(issue.slotId)) map.set(issue.slotId, issue);
    }
    return map;
  }, [legalityIssues, sideboardIssues]);

  const flaggedCardCount = useMemo(() => countFlaggedCards(legalityIssues), [legalityIssues]);

  const deckSizeWarning = useMemo(
    () => validateDeckSize(cards.length, formatConfig),
    [cards.length, formatConfig]
  );
  // A 60-card format registers 15 sideboard cards (E468). Commander's
  // sideboard is uncapped and Considering is never counted.
  const sideboardSizeWarning = useMemo(
    () => validateSideboardSize(sideboard.length, formatConfig),
    [sideboard.length, formatConfig]
  );
  // The legality banner's facts, in reading order: the two size overruns, then
  // the flagged cards.
  const legalityBannerParts = [
    deckSizeWarning,
    sideboardSizeWarning,
    flaggedCardCount > 0
      ? `${flaggedCardCount} ${flaggedCardCount === 1 ? 'card' : 'cards'} flagged in ${formatConfig.label}`
      : null,
  ].filter((part): part is string => !!part);

  // Deck-complete moment: the edit that takes the deck from incomplete to
  // exactly full-size with zero legality flags earns the seal + a toast —
  // today that boundary is a silent badge repaint. Fires only on a transition
  // observed while mounted (never on opening an already-complete deck), and
  // once per deck per app-open (the module-level set), so re-cross edits
  // don't re-celebrate.
  const sealMoment = useDeckCompleteMoment({
    cards,
    flaggedCardCount,
    sideboardSizeWarning,
    formatConfig,
    deckId,
    commander,
    partnerCommander,
  });

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
  // current card list so it stays honest as the deck is edited. On Auto the
  // archetype follows the deck's own engine when one clearly leads, the same
  // engine the Power tab and the playstyle radar read (`resolveAutoArchetype`
  // has the precedence), so the strip can't say Goodstuff while Power says
  // Voltron. The engine is pure oracle-text work over the list, so it is
  // ready on first paint with no flash from one label to another.
  const deckEngine = useMemo(() => analyzeDeckSynergy(allCards), [allCards]);
  const identity = useMemo(
    () =>
      commanderProfile
        ? deriveDeckIdentity({
            profile: commanderProfile,
            selectedThemes,
            cards: allCards,
            persistedArchetype: resolveAutoArchetype({
              override: archetypeOverride,
              build: buildReport,
              engine: deckEngine,
            }),
          })
        : null,
    [commanderProfile, selectedThemes, allCards, buildReport, archetypeOverride, deckEngine]
  );

  // "Why this card" synergy reasons, keyed by card name. Computed from the
  // commander's parsed ability profile so each row can explain its fit.
  const synergyByName = useMemo<Map<string, string[]>>(
    () => buildSynergyByName(commanderProfile, cards),
    [commanderProfile, cards]
  );

  // Per-card pick provenance (S2 — "why is this here"), keyed by card name.
  // Set only on decks generated after this shipped; absent (undefined) for
  // manual/imported/older decks, which keeps every row's tooltip exactly as
  // it rendered before this feature existed.
  const cardProvenance = buildReport?.cardProvenance;

  // "Missing" is a claim about the VIEWER's collection, so it is only
  // answerable when a collection was supplied. Without one, every slot reads
  // as unallocated and the deck reports its own full card count as missing —
  // which is what a shared/public deck did on first ship: "99 missing ($450)"
  // to a guest who has no collection at all, and, for a signed-in visitor, a
  // second number contradicting the ownership-lens strip directly above it.
  // An owner whose collection is genuinely empty still passes a (empty) map
  // and still correctly sees everything as missing.
  // Missing summary — cards in the deck that aren't allocated to a collection
  // copy (i.e. status !== 'allocated'). Surfaces buy-list info inline so we
  // don't need a separate banner above the deck.
  const missing = useMemo(
    () => summarizeMissing(cards, collectionByCopyId, currency),
    [cards, collectionByCopyId, currency]
  );
  // Owned-but-elsewhere count — mainboard cards you own where every copy is in
  // another deck. Drives the "Use my copies (N)" resolver banner. Uses the same
  // cross-deck context as the per-row chips so the number matches the rows.
  const claimedElsewhereCount = useMemo(
    () => countClaimedElsewhere(cards, collectionByCopyId, crossDeck),
    [cards, collectionByCopyId, crossDeck]
  );
  // Tally of the unallocated (missing) cards — the tappable "missing" stat opens
  // a carousel of these so the count doubles as a shopping list.
  const missingTally = useMemo(
    () => buildMissingTally(cards, collectionByCopyId),
    [cards, collectionByCopyId]
  );
  // Every new-arrival row across categories, best fit first — feeds the
  // "N new arrivals" stat and the sheet it opens.
  const arrivalRows = useMemo(
    () =>
      Object.values(arrivalsByType ?? {})
        .flat()
        .sort((a, b) => b.score - a.score),
    [arrivalsByType]
  );
  const autoOpenedArrivals = useRef(false);
  useEffect(() => {
    if (!autoOpenArrivals || autoOpenedArrivals.current || arrivalRows.length === 0) return;
    autoOpenedArrivals.current = true;
    setArrivalsOpen(true);
  }, [autoOpenArrivals, arrivalRows.length]);
  // Mana curve / color demand+production / type breakdown / drill-downs — the
  // shared pure builder so this view and the deck-compare page agree exactly.
  // Deck rows store each card as the cache had it when the card was added, so a
  // deck built before #2011 carries no `produced_mana` at all and the analysis
  // falls back to oracle text — which never reads `{C}`. Backfill it first.
  const manaCards = useProducedMana(allCards);
  const manaData = useMemo(
    () => buildManaData(manaCards, commander, partnerCommander),
    [manaCards, commander, partnerCommander]
  );

  // One count per role for everything on this page that shows one: the role
  // chips, the Roles panel and the deck checks. Live from the mainboard, each
  // card under its one counted role (`countedRoleOf`), commander excluded, the
  // same count the generator, the analysis and the AI's check_bracket use. A
  // generated deck's stored `roleCounts` is a snapshot from generation time;
  // it only stands in until the tagger loads, then the live count takes over,
  // so an edit moves every number together.
  const liveRoles = useMemo(
    () => (taggerReady ? computeRoleCounts(cards.map((dc) => dc.card)) : null),
    [cards, taggerReady]
  );
  const shownRoles = liveRoles ?? {
    roleCounts,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
  };

  // Pass/fail deck-health checklist for the Stats board — legality gates plus the
  // soft role/curve targets, derived from the live list + role analysis. Lives
  // here rather than in DeckAnalysisView so the Deck view can report the same
  // verdict upward (E223's tab badge) without a second, drifting computation.
  const sideboardCap = sideboardLimit(formatConfig);
  const validation = useMemo(
    () =>
      buildValidationChecklist({
        cards: allCards,
        commanderIdentity,
        roleCounts: shownRoles.roleCounts,
        roleTargets,
        averageCmc: manaData.averageCmc,
        format: formatConfig,
        illegalCardNames,
        sideboard:
          sideboardCap === null ? undefined : { count: sideboard.length, limit: sideboardCap },
      }),
    [
      allCards,
      commanderIdentity,
      shownRoles.roleCounts,
      roleTargets,
      manaData.averageCmc,
      formatConfig,
      illegalCardNames,
      sideboardCap,
      sideboard.length,
    ]
  );

  const health = useMemo(() => summarizeValidation(validation), [validation]);

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
  const flat = useMemo(
    () =>
      buildFlatIndex(
        visibleGroups,
        visibleSideboardGroups,
        visibleConsideringGroups,
        rarityCorrections
      ),
    [visibleGroups, visibleSideboardGroups, visibleConsideringGroups, rarityCorrections]
  );

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Hover tracking for the card inspector: which row the pointer (or keyboard
  // focus) is on. Nothing floats; the width gate matches INSPECTOR_QUERY, so the
  // hook only answers where the inspector is mounted to show it.
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
  // View-local transient lens over each card's counted role. An active role
  // keeps every row in place but dims the rest, so matching cards pop without
  // the layout reshuffling. The chip counts ARE the live role counts, and a
  // row lights up under exactly the role it is counted under (countedRoleOf),
  // so a chip's number is the number of mainboard rows it lights.
  const [roleFilter, setRoleFilter] = useState<RoleKey | null>(null);
  const roleFilterEntries = useMemo(
    () =>
      liveRoles
        ? (Object.keys(ROLE_TITLES) as RoleKey[])
            .map((key) => [key, liveRoles.roleCounts[key] ?? 0] as const)
            .filter(([, count]) => count > 0)
        : [],
    [liveRoles]
  );
  // Self-healing: if the active role's last card leaves the deck, deactivate
  // instead of dimming the whole list.
  const activeRoleFilter =
    roleFilter && roleFilterEntries.some(([key]) => key === roleFilter) ? roleFilter : null;
  // The role chips and the glance strip are one line each; past the width
  // they scroll, and the edge with more behind it fades.
  const roleBarRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(roleBarRef, roleFilterEntries.length > 0, roleFilterEntries.length);
  const statStripRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(statStripRef, activeView === 'deck');

  // "Not in the deck" (E176): whether the format has a real sideboard at all
  // (every DECK_FORMAT_CONFIGS entry does today, but the format config's own
  // sideboardSize gate is the single source). false → Considering alone.
  const hasSideboard = formatConfig.sideboardSize > 0;

  // The selection's moves and Remove: the bulk bar's buttons and the menu a
  // right-click on a selected card opens, from one list (T162). Tagging is the
  // bar's Tag popover and the menu's two tag pages, over the same handler.
  const bulkActions: DeckBulkAction[] = buildBulkActions({
    selection,
    hasSideboard,
    onBulkMove,
    onBulkRemove,
    setSelection,
    setConfirmBulkRemove,
  });
  const selectionTitle = selection
    ? `${selection.keys.size} ${selection.keys.size === 1 ? 'card' : 'cards'} selected`
    : '';
  const outzoneGroups = useMemo(
    () =>
      hasSideboard
        ? [...visibleSideboardGroups, ...visibleConsideringGroups]
        : visibleConsideringGroups,
    [hasSideboard, visibleSideboardGroups, visibleConsideringGroups]
  );
  // A tile's menu needs its pile. The grid reports only the row, and a name
  // can sit in both piles, so the row's own slot id decides.
  const sideboardSlotIds = useMemo(() => new Set(sideboard.map((c) => c.slotId)), [sideboard]);
  const outzoneOf = (row: Row): DeckZone =>
    row.slotIds.some((id) => sideboardSlotIds.has(id)) ? 'sideboard' : 'considering';

  const ctxValue = useMemo(
    () => ({
      openCard: () => {},
      openPages: () => {},
      isPreviewOpen: previewIndex !== null,
    }),
    [previewIndex]
  );

  // List view columns: as many as the measured width allows, capped by the
  // deck's own row count so a 100-card deck stops at four columns and the
  // remaining width goes to the card names (listColumnCount). Sections are
  // split into balanced, in-order columns (packSections → packInOrder), so the
  // columns read in the same order the carousel steps through, and the
  // ≤1100px flat single panel stays one column.
  const [listRef, listWidth] = useElementWidth<HTMLDivElement>();
  const narrowList = useMediaQuery('(max-width: 1100px)');
  const commandGroups = useMemo(
    () => visibleGroups.filter((g) => g.icon === 'commander'),
    [visibleGroups]
  );
  const columnGroups = useMemo(
    () => visibleGroups.filter((g) => g.icon !== 'commander'),
    [visibleGroups]
  );
  const listCols = narrowList ? 1 : listColumnCount(listWidth, sectionRowCount(columnGroups));
  const listColumns = useMemo(() => packSections(columnGroups, listCols), [columnGroups, listCols]);

  // Card inspector (2026-09-20): on a wide, hover-capable screen the deck body
  // gets a sticky detail column — in EVERY view mode, which is why it replaced
  // the list-only rail — showing the last card the pointer rested on, the
  // commander until then. The hover hook owns both "which row is under the
  // pointer" (`peek`) and the last non-null answer (`lastPeek`), so the panel
  // doesn't blink back to the commander in the gaps between rows.
  //
  // `pinnedName` wins over the hover answer: reading a card's oracle text is a
  // sustained act, and the pointer crossing another row must not interrupt it.
  // That is the whole reason a persistent panel beats a floating peek here.
  const inspectorActive = useMediaQuery(INSPECTOR_QUERY);
  const [pinnedName, setPinnedName] = useState<string | null>(null);
  const hoverKey = hoverPeek.lastPeek;
  const inspectorCard = useMemo<DeckCardInspectorCard | null>(
    () =>
      buildInspectorCard({
        inspectorActive,
        pinnedName,
        hoverKey,
        commander,
        flat,
        binderByCopyId,
        synergyByName,
        combosByOracle,
        cardInclusionMap,
      }),
    [
      inspectorActive,
      pinnedName,
      hoverKey,
      commander,
      flat,
      binderByCopyId,
      synergyByName,
      combosByOracle,
      cardInclusionMap,
    ]
  );
  const cardMenuCtx = (row: Row, zone: DeckZone): DeckCardActionCtx =>
    buildCardMenuCtx({
      row,
      zone,
      isSingleton: formatConfig.isSingleton,
      hasSideboard,
      onSetQty: onSetQtyForZone(zone),
      handlers: {
        onEditCard,
        onRemoveCard,
        onRemoveSideboardCard,
        onRemoveConsideringCard,
        onMoveToSideboard,
        onMoveToMainboard,
        onMoveToConsidering,
        onMoveFromConsidering,
        onUseOwnCopy,
        onMoveToAnotherDeck,
        onReleaseCopy,
        onMakeCommander,
        canMakeCommander,
        onMakePartner,
        canMakePartner,
        onChangeCommander,
        cover,
        onSetCardTags,
      },
    });

  const renderListSection = (g: TypedGroup) => (
    <CategorySection
      key={g.title}
      deckTags={deckTags.map((t) => t.tag)}
      onSetRowTags={
        onSetCardTags ? (slotIds, tags) => onSetCardTags('cards', slotIds, tags) : undefined
      }
      onRowContextMenu={openCardMenu('cards')}
      menuCtx={(row) => cardMenuCtx(row, 'cards')}
      collapsed={isSectionCollapsed(g.title)}
      onToggleCollapsed={() => toggleSection(g.title)}
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
      onMoveToSideboard={hasSideboard ? onMoveToSideboard : undefined}
      onMoveToConsidering={onMoveToConsidering}
      onMakeCommander={onMakeCommander}
      canMakeCommander={canMakeCommander}
      onMakePartner={onMakePartner}
      canMakePartner={canMakePartner}
      onChangeCommander={onChangeCommander}
      onMoveToAnotherDeck={onMoveToAnotherDeck}
      onReleaseCopy={onReleaseCopy}
      onUseOwnCopy={onUseOwnCopy}
      headerAction={
        g.icon === 'commander' && onEditPartner ? (
          <PartnerHeaderButton hasPartner={!!partnerCommander} onClick={onEditPartner} />
        ) : undefined
      }
      synergyByName={synergyByName}
      cardInclusionMap={cardInclusionMap}
      combosByOracle={combosByOracle}
      cardProvenance={cardProvenance}
    />
  );

  // The same section as the deck's own, pointed at its pile's handlers. Roles
  // are not passed: the role lens counts the deck, so it never dims these.
  const renderOutzoneSection = (g: TypedGroup) => {
    const zone: DeckZone = g.icon === 'sideboard' ? 'sideboard' : 'considering';
    const inSideboard = zone === 'sideboard';
    return (
      <CategorySection
        key={g.title}
        title={g.title}
        icon={g.icon}
        rows={g.rows}
        empty={g.empty}
        collapsed={collapsedOutzoneTitles.has(g.title)}
        onToggleCollapsed={() => toggleOutzoneSection(g.title)}
        deckTags={deckTags.map((t) => t.tag)}
        onSetRowTags={
          onSetCardTags ? (slotIds, tags) => onSetCardTags(zone, slotIds, tags) : undefined
        }
        onRowContextMenu={openCardMenu(zone)}
        menuCtx={(row) => cardMenuCtx(row, zone)}
        currency={currency}
        showPrefs={showPrefs}
        onRowClick={openPreview}
        onRemoveCard={inSideboard ? onRemoveSideboardCard : onRemoveConsideringCard}
        onSetQty={onSetQtyForZone(zone)}
        selectMode={selectMode}
        isRowSelected={(row) => isRowSelected(zone, row)}
        onToggleRowSelected={(row) => toggleRowSelected(zone, row)}
        dragEnabled={sort === 'custom'}
        onReorder={onReorderForZone(zone)}
        // Considering is copy-limit exempt (E122) regardless of format
        // singleton rules — never the 1-copy cap `isSingleton ?? true` would
        // otherwise fall back to.
        isSingleton={inSideboard ? formatConfig.isSingleton : false}
        onEditCard={inSideboard ? onEditCard : undefined}
        legalityBySlot={legalityBySlot}
        onMoveToMainboard={inSideboard ? onMoveToMainboard : onMoveFromConsidering}
        onMakeCommander={inSideboard ? onMakeCommander : undefined}
        canMakeCommander={canMakeCommander}
        onMakePartner={inSideboard ? onMakePartner : undefined}
        canMakePartner={canMakePartner}
        onMoveToAnotherDeck={inSideboard ? onMoveToAnotherDeck : undefined}
        onReleaseCopy={inSideboard ? onReleaseCopy : undefined}
        onUseOwnCopy={inSideboard ? onUseOwnCopy : undefined}
        synergyByName={synergyByName}
        cardInclusionMap={cardInclusionMap}
        combosByOracle={combosByOracle}
        cardProvenance={cardProvenance}
      />
    );
  };

  const renderAnalysis = (view: AnalysisTabId) => (
    <DeckAnalysisView
      view={view}
      illegalCardNames={illegalCardNames}
      formatLabel={formatConfig.label}
      allCards={allCards}
      manaData={manaData}
      bracketEstimation={bracketEstimation}
      deckCardsByName={deckCardsByName}
      bracketOverride={bracketOverride}
      bracketMissesCombos={bracketMissesCombos}
      onSetBracketOverride={onSetBracketOverride}
      clockLibrary={clockLibrary}
      bracketTableSlot={bracketTableSlot}
      archetypeOverride={archetypeOverride}
      onSetArchetypeOverride={onSetArchetypeOverride}
      roleCounts={shownRoles.roleCounts}
      roleTargets={roleTargets}
      buildReport={buildReport}
      rampSubtypeCounts={shownRoles.rampSubtypeCounts}
      removalSubtypeCounts={shownRoles.removalSubtypeCounts}
      boardwipeSubtypeCounts={shownRoles.boardwipeSubtypeCounts}
      cardDrawSubtypeCounts={shownRoles.cardDrawSubtypeCounts}
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
      validation={validation}
      analysisState={analysisState}
      onNavigateToTune={onNavigateToTune}
      onRetryAnalysis={onRetryAnalysis}
      edhrecMissing={edhrecMissing}
      commander={commander}
      partnerCommander={partnerCommander}
      format={format}
      identity={identity}
      scoreRevealKey={scoreRevealKey}
      onAddSuggestedCard={onAddSuggestedCard}
      addingSuggestedCardNames={addingSuggestedCardNames}
      oneAwayCombos={oneAwayCombos}
      ownedOracleIds={ownedOracleIds}
      landUpgradeCount={landUpgradeCount}
    />
  );

  return (
    <CardPreviewContext.Provider value={ctxValue}>
      <div
        className="deck-display"
        {...(tabbed && {
          role: 'tabpanel',
          id: `deck-view-panel-${activeView}`,
          'aria-labelledby': `sc-tab-${activeView}`,
        })}
      >
        {/* The level between the page's h1 (the deck name) and the h3
            sections under it: the tab shows this name visually. */}
        <h2 className="sr-only">{VIEW_HEADINGS[activeView]}</h2>
        {/* Root-level so the deck-complete moment plays from any view (a
            Coach apply on the Tune view can complete the deck too). */}
        {sealMoment}
        {/* `deck` view: the card-list editing surface (toolbar + banner + body).
            The analysis views (stats/power/tune) replace it full-width — the
            page-top hub tab bar in DeckEditorPage switches between them. */}
        {activeView === 'deck' ? (
          <>
            <DeckStatStrip
              stripRef={statStripRef}
              health={health}
              onHealthClick={scrollToDeckStats}
              averageCmc={manaData.averageCmc}
              identity={identity}
              missing={viewerMissing ?? missing}
              hasMissingCards={viewerMissing ? true : missingTally.length > 0}
              currency={currency}
              onOpenBuyList={viewerMissing?.onOpen ?? (() => setBuyListOpen(true))}
              openSlots={openSlots}
              onFill={onFill}
              arrivalCount={arrivalRows.length}
              onOpenArrivals={() => setArrivalsOpen(true)}
            />
            {statCarousel.preview}

            <DeckToolbar
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
              canBulkEdit={canBulkEdit}
              selectMode={selectMode}
              onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              editActions={editActions}
              deckActionsInHeader={deckActionsInHeader}
            />

            {selectMode && (
              <DeckBulkBar
                selection={selection}
                selectionTitle={selectionTitle}
                bulkActions={bulkActions}
                deckTagNames={deckTags.map((t) => t.tag)}
                onBulkEditTag={onBulkEditTag}
                onDone={exitSelectMode}
              />
            )}

            {confirmBulkRemove && selection && onBulkRemove && (
              <ConfirmDialog
                title={`Remove ${selection.keys.size} ${selection.keys.size === 1 ? 'card' : 'cards'}?`}
                body="Removes the selected cards. You can undo this from history."
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

            {legalityBannerParts.length > 0 && (
              <div className="deck-legality-banner">
                <CircleAlert width={16} height={16} strokeWidth={2} aria-hidden />
                {legalityBannerParts.map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 && <span aria-hidden>·</span>}
                    <span>{part}</span>
                  </Fragment>
                ))}
              </div>
            )}

            {onReviewShared && claimedElsewhereCount > 0 && (
              <div className="deck-claimed-banner">
                <Layers width={16} height={16} strokeWidth={2} aria-hidden />
                <span className="deck-claimed-banner-text">
                  {claimedElsewhereCount} {claimedElsewhereCount === 1 ? 'card' : 'cards'} here{' '}
                  {claimedElsewhereCount === 1 ? 'is' : 'are'} also in your other decks
                </span>
                <Button onClick={onReviewShared} className="deck-claimed-banner-btn">
                  Review
                </Button>
              </div>
            )}

            {roleFilterEntries.length > 0 && (
              <DeckRoleBar
                barRef={roleBarRef}
                entries={roleFilterEntries}
                active={activeRoleFilter}
                setRoleFilter={setRoleFilter}
              />
            )}

            <div className="deck-display-body">
              <div className="deck-display-main">
                {visibleGroups.length === 0 && (
                  <DeckEmptyState chooseCommander={chooseCommander} onAddCards={onAddCards} />
                )}
                {/* The Roles lens is a strict PARTITION: `classifyCardCategory`
                    files each card under exactly one heading, type first, so the
                    buckets sum to the deck. Type first means a removal creature
                    sits under Creatures here while the role chips count it as
                    Removal; this line names the rule so the headings read right
                    (playtest batch 6, E330). */}
                {groupBy === 'category' && visibleGroups.length > 0 && (
                  <p className="deck-group-caption">Each card is filed under one role.</p>
                )}
                {/* The tag lens partitions too, so it gets the same reconciling
                    line. It also carries the tag manager: renaming or removing
                    a tag deck-wide has no other door, and this is the lens a
                    reader is in when they want one. */}
                {groupBy === 'tag' && visibleGroups.length > 0 && (
                  <div className="deck-group-caption deck-group-caption--managed">
                    <span>Each card is filed under its first tag, or its card type.</span>
                    {deckTags.length > 0 && (onRenameDeckTag || onRemoveDeckTag) && (
                      <ToolbarPopover
                        triggerClassName={`${buttonClass()} deck-tag-manage-btn`}
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
                {/* The deck body (2026-09-20): one two-column layout for ALL
                    view modes, so the card inspector is a single surface rather
                    than a list-only rail plus a grid-only floating peek. The
                    toolbar and filter-chip bands above stay full width, which is
                    what lets the inspector sit on the LEFT without moving the
                    page's alignment line off the gutter.

                    It wraps EVERYTHING below the toolbar — the card body AND the
                    "Not in the deck" zone — because a sticky element only sticks
                    for the height of its containing block. With the outzone left
                    outside, the inspector came unstuck at the end of the card
                    list and rode up under the header for the rest of the page. */}
                <div className={inspectorActive ? 'deck-body-layout' : undefined}>
                  {inspectorActive && visibleGroups.length > 0 && (
                    <DeckCardInspector
                      card={inspectorCard}
                      currency={currency}
                      pinned={pinnedName !== null}
                      onTogglePin={() =>
                        setPinnedName((prev) => (prev ? null : (inspectorCard?.row.name ?? null)))
                      }
                      onOpen={openPreview}
                      actions={{
                        onMoveToSideboard: hasSideboard ? onMoveToSideboard : undefined,
                        onMoveToConsidering,
                        onRemoveCard,
                      }}
                    />
                  )}
                  {/* The grid/stacks tiles feed the inspector through the same
                        delegated hover handlers the list uses. They attach only
                        while the inspector is mounted: below the gate a grid tile
                        already shows its own art, so a floating peek over it
                        would be noise. */}
                  <div
                    className="deck-body-main"
                    {...(inspectorActive && viewMode !== 'list' ? hoverPeek.listHandlers : {})}
                  >
                    {visibleGroups.length > 0 &&
                      (viewMode === 'list' ? (
                        <div
                          className="deck-card-list"
                          ref={listRef}
                          style={{ '--deck-cols': listCols } as CSSProperties}
                          {...hoverPeek.listHandlers}
                          {...touchPeek.listHandlers}
                        >
                          {/* Command zone — the commander (and partner) as a full-width
                          strip ABOVE the type columns, rendered with the same
                          CategorySection/DeckMainboardRow as every other card so the
                          interactions are identical. It never occupies a column: a
                          1-row section at the top of a column stranded a 30-row hole
                          under it. Its rows align to the column grid below. */}
                          {commandGroups.length > 0 ? (
                            <div className="deck-command-zone">
                              {commandGroups.map(renderListSection)}
                            </div>
                          ) : (
                            chooseCommander && <CommanderOpenSlot onChoose={chooseCommander} />
                          )}
                          <div className="deck-card-columns">
                            {listColumns.map((column, i) => (
                              <div key={i} className="deck-card-column">
                                {column.map(renderListSection)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Grid and stacks have no command-zone strip of their
                            own (the commander is a group among the tiles), so
                            the open slot leads them the same way it leads the
                            list: no view is left without a way in. */}
                          {chooseCommander && <CommanderOpenSlot onChoose={chooseCommander} />}
                          <DeckCardGrid
                            layout={viewMode}
                            groups={visibleGroups}
                            currency={currency}
                            showPrice={showPrefs.price}
                            collapsedTitles={collapsedTitlesForLens}
                            onToggleSection={toggleSection}
                            onRowContextMenu={openCardMenu('cards')}
                            onRowMenu={openCardMenuAt('cards')}
                            rowHasMenu={(row) => hasCardActions(cardMenuCtx(row, 'cards'))}
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
                          />
                        </>
                      ))}

                    {/* "Not in the deck" (E176): Sideboard and Considering as two
                    more sections at the foot of the deck, drawn by the same
                    renderer the deck uses in the current view (tiles, stacks or
                    rows) with the same header, so they read as more of the deck
                    rather than a form under it. They used to be a bordered panel
                    with a Sideboard | Considering tab strip that always showed
                    rows, even in grid view; next to a wall of card art that
                    looked like another app. Inside `.deck-body-main` so the
                    inspector column stays stuck alongside them. The Sideboard
                    is format-gated; Considering (E122) is always here. Neither
                    feeds stats, legality, mana or role counts (see the
                    `cards`-only `allCards`/`legalityIssues` memos above). Always
                    mounted, even at 0/0: they are where "Move to sideboard" and
                    "Move to considering" land, and the target of the page
                    hero's "+N sideboard" link. */}
                    <section
                      className="deck-outzone"
                      id="deck-outzone"
                      tabIndex={-1}
                      aria-label="Not in the deck"
                    >
                      {viewMode === 'list' ? (
                        // The deck's own column grid, so a pile is exactly as
                        // wide as a column above it.
                        <div
                          className="deck-card-columns"
                          style={{ '--deck-cols': listCols } as CSSProperties}
                          {...hoverPeek.listHandlers}
                          {...touchPeek.listHandlers}
                        >
                          {outzoneGroups.map((g) => (
                            <div key={g.title} className="deck-card-column">
                              {renderOutzoneSection(g)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <DeckCardGrid
                          layout={viewMode}
                          groups={outzoneGroups}
                          currency={currency}
                          showPrice={showPrefs.price}
                          collapsedTitles={collapsedOutzoneTitles}
                          onToggleSection={toggleOutzoneSection}
                          onRowContextMenu={(row, e) => openCardMenu(outzoneOf(row))(row, e)}
                          onRowMenu={(row, trigger) => openCardMenuAt(outzoneOf(row))(row, trigger)}
                          rowHasMenu={(row) => hasCardActions(cardMenuCtx(row, outzoneOf(row)))}
                          onRowClick={openPreview}
                          legalityBySlot={legalityBySlot}
                          gridZoom={effectiveGridZoom}
                          gridWidth={gridWidth}
                          showRoles={showPrefs.roles}
                          synergyByName={synergyByName}
                          binderByCopyId={binderByCopyId}
                        />
                      )}
                    </section>

                    {onAddFromSearch && search.trim().length >= 1 && noDeckMatches && (
                      <button
                        type="button"
                        className="deck-display-scryfall-trigger"
                        onClick={() => onAddFromSearch(search.trim())}
                        aria-label={`Search Scryfall for ${search.trim()} to add a card not in this deck`}
                      >
                        <Search width={16} height={16} strokeWidth={1.8} aria-hidden />
                        <span className="deck-display-scryfall-trigger-text">
                          <span className="deck-display-scryfall-trigger-title">
                            Search Scryfall
                          </span>
                          <span className="deck-display-scryfall-trigger-sub">
                            for "{search.trim()}", add a card not in this deck
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* Deck stats sit under the list, the way Moxfield and Archidekt
                lay a deck out: edit the list, then read what it did to the
                curve and colours without switching tabs. Power and Coach
                stay tabs; they are verdicts and actions, and load async. */}
            <section className="deck-stats-below" aria-labelledby={DECK_STATS_HEADING_ID}>
              {/* h3, like its twin "Not in the deck"; the panels are h4. */}
              <h3 id={DECK_STATS_HEADING_ID} className="deck-stats-below-heading">
                Deck stats
              </h3>
              {renderAnalysis('stats')}
            </section>
          </>
        ) : (
          renderAnalysis(activeView)
        )}

        {/* Touch long-press peek (E129) — a printing sub-row's own art
            (data-peek-img), else the card's hero art by name; portaled to
            <body> so it can't get trapped by a `container-type`/transform
            ancestor. */}
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
              return r ? bindersForRow(r, binderByCopyId) : [];
            }}
            getStackAllocations={(i) => {
              const r = flat.rows[i];
              return r ? allocationsForRow(r, crossDeck.otherDeckAllocations) : [];
            }}
            getActions={(i) =>
              buildPreviewActions({
                row: flat.rows[i],
                onEditCard,
                onRemoveCard,
                closePreview: () => setPreviewIndex(null),
              })
            }
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
        {arrivalsOpen && (
          <NewArrivalsSheet
            rows={arrivalRows}
            onClose={() => setArrivalsOpen(false)}
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
        {/* Print-only checklist (name/qty/set-cn), grouped like the list
            view. Invisible on screen (styles/print.css's `.print-list`);
            DeckExportDialog's "Print list" action closes itself and calls
            window.print(), which the print stylesheet then renders as this
            instead of the normal interactive view. */}
        <div className="print-list" aria-hidden>
          <h1 className="print-list-title">{title}</h1>
          {visibleGroups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.title} className="print-list-section">
                <h2 className="print-list-section-title">{g.title}</h2>
                <ul>
                  {g.rows.map((row) => (
                    <li key={row.slotIds[0] ?? row.name}>
                      <span className="print-list-qty">{row.qty}</span>
                      <span className="print-list-name">
                        <CardName card={row} oracleFirst />
                      </span>
                      <span className="print-list-printing">
                        {row.setCode.toUpperCase()} {row.collectorNumber}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {visibleSideboardGroups.some((g) => g.rows.length > 0) && (
            <section className="print-list-section">
              <h2 className="print-list-section-title">Sideboard</h2>
              <ul>
                {visibleSideboardGroups
                  .flatMap((g) => g.rows)
                  .map((row) => (
                    <li key={row.slotIds[0] ?? row.name}>
                      <span className="print-list-qty">{row.qty}</span>
                      <span className="print-list-name">
                        <CardName card={row} oracleFirst />
                      </span>
                      <span className="print-list-printing">
                        {row.setCode.toUpperCase()} {row.collectorNumber}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
        {/* One menu for the whole surface, rendered last so it sits over the
            list, the tiles and the inspector alike. */}
        {cardMenu && (
          <DeckCardMenu
            row={cardMenu.row}
            x={cardMenu.x}
            y={cardMenu.y}
            target={cardMenu.target}
            deckTags={deckTags.map((t) => t.tag)}
            ctx={cardMenuCtx(cardMenu.row, cardMenu.zone)}
            onClose={() => setCardMenu(null)}
          />
        )}
        {selectionMenu && selection && (
          <DeckSelectionMenu
            title={selectionTitle}
            x={selectionMenu.x}
            y={selectionMenu.y}
            target={selectionMenu.target}
            actions={bulkActions}
            deckTags={deckTags.map((t) => t.tag)}
            onTag={
              onBulkEditTag
                ? (tag, add) => onBulkEditTag(selection.zone, [...selection.keys], tag, add)
                : undefined
            }
            onClose={() => setSelectionMenu(null)}
          />
        )}
      </div>
    </CardPreviewContext.Provider>
  );
}

const VIEW_HEADINGS: Record<DeckView, string> = {
  deck: 'Deck',
  stats: 'Deck stats',
  power: 'Power',
  tune: 'Coach',
};

/** The "Deck stats" heading under the list; 'stats' is a place on the Deck
 *  tab now, not a tab of its own. */
export const DECK_STATS_HEADING_ID = 'deck-stats-heading';

/** Scroll the Deck tab down to its stats and move focus there. */
export function scrollToDeckStats() {
  scrollToHeading(DECK_STATS_HEADING_ID);
}
