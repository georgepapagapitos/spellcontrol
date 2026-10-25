import '@/styles/deck-builder-card-list.css';
import '@/styles/deck-builder-analysis.css';
import { CircleAlert, Layers } from 'lucide-react';
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useOverflowEdges } from '@/lib/util/use-overflow-edges';
import { useDeckViewAnalytics } from '@/lib/util/use-deck-view-analytics';
import { useCurrency } from '@/lib/collection/currency';
import { useDeckPrices } from './use-deck-prices';
import { useDeckViewPrefs } from './use-deck-view-prefs';
import { useDeckSelection } from './use-deck-selection';
import { useDeckCardMenu } from './use-deck-card-menu';
import { useDeckLegality } from './use-deck-legality';
import { useDeckRows } from './use-deck-rows';
import { useDeckAnalysis } from './use-deck-analysis';
import { useDeckMissing } from './use-deck-missing';
import { DeckCardPreview } from './DeckCardPreview';
import { DeckPrintList } from './DeckPrintList';
import { createPortal } from 'react-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckTagManager } from './DeckTagManager';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { scrollToHeading } from '@/lib/util/scroll-to-heading';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { DeckExportDialog } from '../shared/DeckExportDialog';
import { useDeckExportText } from './use-deck-export-text';
import type { DeckZone } from '../../store/decks';
import { CardPreviewContext } from '@/components/binder/CardPreviewContext';
import { BuyListDialog } from './BuyListDialog';
import { DeckTouchPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useTouchPeek } from '@/lib/overlays/use-touch-peek';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';

import { useRarityCorrections } from '@/lib/deck/use-rarity-corrections';
import { NewArrivalsSheet } from './NewArrivalsSheet';
import { ROLE_TITLES, type RoleKey } from '@/lib/deck-analysis/role-badges';
import { useElementWidth } from '@/lib/util/use-element-width';
import { useMediaQuery } from '@/lib/util/use-media-query';

import { ToolbarPopover } from '../shared/ToolbarPopover';
import {
  type CurrencyCode,
  type Row,
  type TypedGroup,
  packSections,
  listColumnCount,
  sectionRowCount,
} from './deck-display-rows';
import { DeckCardInspector, type DeckCardInspectorCard } from './DeckCardInspector';
import { DeckToolbar } from './DeckToolbar';
import { DeckCardMenu } from './DeckCardMenu';
import { DeckSelectionMenu, type DeckBulkAction } from './DeckSelectionMenu';
import { type DeckCardActionCtx } from './deck-card-actions';
import { DeckMainSection, DeckOutzone, ScryfallSearchTrigger, type DeckBodyCtx } from './DeckBody';
import { MainboardZoneSection, OutzoneZoneSection, type ZoneSectionCtx } from './DeckZoneSection';
import { DeckAnalysisPane } from './DeckAnalysisPane';
import { buttonClass } from '@/components/shared/Button';
import type { DeckDisplayProps } from './deck-display-types';
import { VIEW_HEADINGS } from '@/lib/deck-analysis/deck-view';
import type { AnalysisTabId } from '@/lib/deck-analysis/deck-view';
import { buildFlatIndex, buildInspectorCard, bindQtyToZone } from './deck-display-derive';
import { buildCardMenuCtx, buildBulkActions } from './deck-display-actions';
import { useDeckCompleteMoment } from './use-deck-complete-moment';
import { DeckStatStrip, DeckBulkBar, DeckRoleBar, DeckEmptyState } from './DeckDisplayBands';

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
export type { DeckDisplayCard, DeckDisplayProps } from './deck-display-types';
import '@/styles/deck-builder-deck-extras.css';

/** Renders its children into `slot` when one is given, else in place. */
function InSlot({ slot, children }: { slot?: HTMLElement | null; children: ReactNode }) {
  return slot ? createPortal(children, slot) : children;
}

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay(props: DeckDisplayProps) {
  const {
    title,
    deckId,
    format = 'commander',
    commander,
    partnerCommander,
    selectedThemes,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    commanderReleased,
    partnerCommanderReleased,
    cards,
    sideboard = [],
    considering = [],
    archetypeOverride,
    // deckGrade: removed from stat-strip (UX-315: one grading system; letter grades dropped)
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
    onSetProxy,
    onUseOwnCopy,
    collectionByCopyId,
    binderByCopyId,
    exportOpen: exportOpenProp,
    onExportOpenChange,
    onAddFromSearch,
    renderSwapSuggestions,
    renderSimilarCards,
    activeView = 'deck',
    tabbed = true,
    onShowTestHand,
    editActions,
    suggestGroups,
    deckActionsInHeader,
    statStripSlot,
    sinceSlot,
    onAddCards,
    onChooseCommander,
    onAddSuggestedCard,
    openSlots,
    onFill,
    addingSuggestedCardNames,
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
  } = props;
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  // The format has a command zone and it's empty, and this host can fill it
  // (E465). Drives the open-slot row and the empty state's second door.
  const chooseCommander = formatConfig.hasCommander && !commander ? onChooseCommander : undefined;
  const currency: CurrencyCode = useCurrency();
  // Resolves printings the device price cache lacks and ticks when prices land,
  // so the row prices and totals below recompute (E422).
  const pricesVersion = useDeckPrices([commander, partnerCommander, ...cards.map((c) => c.card)]);
  const {
    sort,
    sortDir,
    onToggleSort,
    search,
    setSearch,
    exportFormat,
    handleExportFormatChange,
    viewMode,
    handleViewModeChange,
    groupBy,
    handleGroupByChange,
    isSectionCollapsed,
    toggleSection,
    toggleOutzoneSection,
    collapsedTitlesForLens,
    collapsedOutzoneTitles,
    effectiveGridZoom,
    handleGridZoomChange,
    isNarrowGrid,
    showPrefs,
    handleShowPrefsChange,
  } = useDeckViewPrefs();
  const canBulkEdit = !!(onBulkRemove || onBulkMove || onBulkEditTag);
  const {
    selectMode,
    setSelectMode,
    selection,
    setSelection,
    confirmBulkRemove,
    setConfirmBulkRemove,
    exitSelectMode,
    isRowSelected,
    toggleRowSelected,
  } = useDeckSelection();
  // Measured width of a rendered card grid — the zoom stepper needs it to skip
  // steps that wouldn't change the column count at this size. In the grid
  // view that is the whole grid (every group sits on its shared columns); in
  // stacks, a stack's own list. DeckCardGrid attaches it to the right element.
  const [gridRef, gridWidth] = useElementWidth<HTMLElement>();
  // Filing is only useful if the reader can see it, so it opens the Tags lens.
  const toolbarEditActions =
    editActions && suggestGroups
      ? [
          ...editActions,
          {
            label: 'Suggest groups',
            icon: Layers,
            disabled: suggestGroups.pending,
            onClick: () => {
              suggestGroups.run();
              handleGroupByChange('tag');
            },
          },
        ]
      : editActions;

  // Whether the bundled tagger data (role classification) has loaded —
  // gates category-view grouping below, same source as the role-filter bar's
  // roleFilterEntries further down. Declared here (rather than down by the
  // role filter) so the mainboard groups memo can depend on it too.
  const taggerReady = useTaggerReady();

  const {
    crossDeck,
    deckTags,
    visibleGroups,
    visibleSideboardGroups,
    visibleConsideringGroups,
    noDeckMatches,
  } = useDeckRows({
    cards,
    sideboard,
    considering,
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    commanderReleased,
    partnerCommanderReleased,
    collectionByCopyId,
    ownershipFor,
    deckId,
    currency,
    pricesVersion,
    groupBy,
    categoryTargets,
    taggerReady,
    search,
    sort,
    sortDir,
  });

  const {
    illegalCardNames,
    legalityBySlot,
    flaggedCardCount,
    sideboardSizeWarning,
    legalityBannerParts,
  } = useDeckLegality({ cards, sideboard, formatConfig, commander, partnerCommander });

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

  const {
    allCards,
    deckCardsByName,
    identity,
    synergyByName,
    manaCards,
    manaData,
    liveRoles,
    shownRoles,
    validation,
    health,
  } = useDeckAnalysis({
    cards,
    sideboardCount: sideboard.length,
    commander,
    partnerCommander,
    formatConfig,
    illegalCardNames,
    taggerReady,
    selectedThemes,
    archetypeOverride,
    buildReport,
    roleCounts,
    roleTargets,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
  });

  // Per-card pick provenance (S2 — "why is this here"), keyed by card name.
  // Set only on decks generated after this shipped; absent (undefined) for
  // manual/imported/older decks, which keeps every row's tooltip exactly as
  // it rendered before this feature existed.
  const cardProvenance = buildReport?.cardProvenance;

  const {
    missing,
    missingTally,
    arrivalRows,
    arrivalsOpen,
    setArrivalsOpen,
    buyListOpen,
    setBuyListOpen,
    pickBuyListCard,
    statCarouselPreview,
  } = useDeckMissing({
    title,
    cards,
    collectionByCopyId,
    currency,
    pricesVersion,
    arrivalsByType,
    autoOpenArrivals,
  });

  const exportText = useDeckExportText(
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
  );
  // If the parent passes both props, treat it as a controlled component
  // (their boolean wins). Otherwise fall back to internal state — keeps
  // simple callers ergonomic and avoids any setState-in-effect dance.
  const [internalExportOpen, setInternalExportOpen] = useState(false);
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
  const statsHeadingRef = useRef<HTMLHeadingElement>(null);
  useDeckViewAnalytics(activeView, statsHeadingRef);

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
      onSetQty: bindQtyToZone(onSetQty, zone),
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
        onSetProxy,
        onMakeCommander,
        canMakeCommander,
        onMakePartner,
        canMakePartner,
        onChangeCommander,
        cover,
        onSetCardTags,
      },
    });

  const { cardMenu, setCardMenu, selectionMenu, setSelectionMenu, openCardMenu, openCardMenuAt } =
    useDeckCardMenu({ selectMode, selection, isRowSelected, menuCtx: cardMenuCtx });

  const bodyCtx: DeckBodyCtx = {
    viewMode,
    currency,
    showPrefs,
    legalityBySlot,
    gridZoom: effectiveGridZoom,
    gridWidth,
    synergyByName,
    binderByCopyId,
    listHandlers: { ...hoverPeek.listHandlers, ...touchPeek.listHandlers },
    openPreview,
    openCardMenu,
    openCardMenuAt,
    cardMenuCtx,
  };

  const zoneCtx: ZoneSectionCtx = {
    ...bodyCtx,
    deckTags: deckTags.map((t) => t.tag),
    selectMode,
    isRowSelected,
    toggleRowSelected,
    dragEnabled: sort === 'custom',
    isSingleton: formatConfig.isSingleton,
    hasSideboard,
    cardProvenance,
  };
  const renderListSection = (g: TypedGroup) => (
    <MainboardZoneSection
      key={g.title}
      group={g}
      ctx={zoneCtx}
      host={props}
      collapsed={isSectionCollapsed(g.title)}
      onToggleCollapsed={() => toggleSection(g.title)}
      roleFilter={activeRoleFilter}
    />
  );
  const renderOutzoneSection = (g: TypedGroup) => (
    <OutzoneZoneSection
      key={g.title}
      group={g}
      ctx={zoneCtx}
      host={props}
      collapsed={collapsedOutzoneTitles.has(g.title)}
      onToggleCollapsed={() => toggleOutzoneSection(g.title)}
    />
  );

  const renderAnalysis = (view: AnalysisTabId) => (
    <DeckAnalysisPane
      view={view}
      host={props}
      format={format}
      formatLabel={formatConfig.label}
      illegalCardNames={illegalCardNames}
      allCards={allCards}
      manaCards={manaCards}
      manaData={manaData}
      deckCardsByName={deckCardsByName}
      shownRoles={shownRoles}
      validation={validation}
      identity={identity}
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
            {/* On a desktop the page hands a slot on its tab row; the strip
                renders there, state and handlers still this component's. */}
            <InSlot slot={statStripSlot}>
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
            </InSlot>
            {statCarouselPreview}
            {sinceSlot}

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
              editActions={toolbarEditActions}
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
                body="You can undo this from history."
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
                  <p className="deck-group-caption">Each card counts once, under its main role.</p>
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
                        onSetProxy,
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
                    <DeckMainSection
                      ctx={bodyCtx}
                      groups={visibleGroups}
                      chooseCommander={chooseCommander}
                      listRef={listRef}
                      listCols={listCols}
                      commandGroups={commandGroups}
                      listColumns={listColumns}
                      renderListSection={renderListSection}
                      collapsedTitles={collapsedTitlesForLens}
                      onToggleSection={toggleSection}
                      gridRef={gridRef}
                      roleFilter={activeRoleFilter}
                      hasPartner={!!partnerCommander}
                      onEditPartner={onEditPartner}
                    />
                    <DeckOutzone
                      ctx={bodyCtx}
                      groups={outzoneGroups}
                      listCols={listCols}
                      collapsedTitles={collapsedOutzoneTitles}
                      onToggleSection={toggleOutzoneSection}
                      zoneOf={outzoneOf}
                      renderSection={renderOutzoneSection}
                    />
                    {onAddFromSearch && search.trim().length >= 1 && noDeckMatches && (
                      <ScryfallSearchTrigger query={search.trim()} onSearch={onAddFromSearch} />
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
              <h3
                ref={statsHeadingRef}
                id={DECK_STATS_HEADING_ID}
                className="deck-stats-below-heading"
              >
                Deck stats
              </h3>
              {renderAnalysis('stats')}
            </section>
          </>
        ) : (
          renderAnalysis(activeView)
        )}

        {touchPeek.peek && <DeckTouchPeek peek={touchPeek.peek} flat={flat} />}

        {previewIndex !== null && (
          <DeckCardPreview
            flat={flat}
            index={previewIndex}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
            title={title}
            deckId={deckId}
            commander={commander}
            cards={cards}
            existingDeckTags={deckTags.map((t) => t.tag)}
            synergyByName={synergyByName}
            cardInclusionMap={cardInclusionMap}
            legalityBySlot={legalityBySlot}
            binderByCopyId={binderByCopyId}
            crossDeck={crossDeck}
            onSetCardTags={onSetCardTags}
            onEditCard={onEditCard}
            onRemoveCard={onRemoveCard}
            renderSwapSuggestions={renderSwapSuggestions}
            renderSimilarCards={renderSimilarCards}
          />
        )}
        {buyListOpen && (
          <BuyListDialog
            tally={missingTally}
            currency={currency}
            title={title}
            onClose={() => setBuyListOpen(false)}
            onPickCard={pickBuyListCard}
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
        <DeckPrintList
          title={title}
          groups={visibleGroups}
          sideboardGroups={visibleSideboardGroups}
        />
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

/** The "Deck stats" heading under the list; 'stats' is a place on the Deck
 *  tab now, not a tab of its own. */
export const DECK_STATS_HEADING_ID = 'deck-stats-heading';

/** Scroll the Deck tab down to its stats and move focus there. */
export function scrollToDeckStats() {
  scrollToHeading(DECK_STATS_HEADING_ID);
}
