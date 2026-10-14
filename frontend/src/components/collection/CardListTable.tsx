import { EmptyState } from '@/components/shared/EmptyState';
import { Bookmark, ListPlus, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder } from '@/types/index';
import type { SetMap } from '@/lib/api';
import { CardRowMenu } from './CardRowMenu';
import { CardPreview } from '@/components/card/CardPreview';
import { renderFriendOwners } from '@/components/trade/FriendOwnersPanel';
import { CardEditDialog } from './CardEditDialog';
import { RemoveCopiesDialog } from './RemoveCopiesDialog';
import { BulkMoveToBinderSheet } from '@/components/binder/BulkMoveToBinderSheet';
import { useCollectionStore } from '@/store/collection';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import { useCubeListings } from '@/lib/cube/cube-listings';
import { breakdownCopies } from '@/lib/collection/copy-locations';
import { indexCardLocations } from '@/lib/binder/card-locations';
import type { CollectionFilterJump } from '@/lib/collection/collection-insights';
import { GRID_GAP_PX, clampZoom, readStoredZoom, zoomBucket } from '@/lib/util/grid-zoom';
import { SearchPill } from '@/components/search/SearchPill';
import { CollectionFiltersDialog } from '@/components/search/CollectionFiltersDialog';
import { SaveToListDialog } from '@/components/lists/SaveToListDialog';
import { useCardsWithTags } from '@/lib/cards/card-tags';
import { useCardsWithReleaseDates } from '@/lib/cards/card-release-dates';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { sortDirectionLabel, isExpressionEmpty } from '@spellcontrol/binder-routing';
import { CardRow } from '@/components/shared/CardRow';
import { SectionHeaderBar } from '@/components/shared/SectionHeaderBar';
import {
  CardTableFrame,
  CardTableHead,
  COLLECTION_TABLE_COLUMNS,
} from '@/components/shared/CardTable';
import { useGridCaptionPrefs } from '@/components/shared/CardGridCell';
import { FilterChipsRow } from '@/components/shared/FilterChipsRow';
import { printingStubFromEnriched } from '@/lib/collection/edit-card';
import { Button } from '@/components/shared/Button';
import { CardListBulkToolbar } from './CardListBulkToolbar';
import { CardListControls } from './CardListControls';
import { CardListGridCell } from './CardListGridCell';
import { CardListGridRows, CardListListHandoff, CardListListRows } from './CardListVirtualRows';
import {
  useAllocationsFor,
  useCollectionHotkeys,
  useIsNarrow,
  useSubtypeSuggestions,
} from './card-list-table-hooks';
import { useCollectionFilters, useFilteredRows } from './card-list-table-filters';
import { useRowSelection } from './card-list-table-selection';
import { useCollectionRowActions, useSaveToList } from './card-list-table-actions';
import { useGroupedRows, useTableLayout } from './card-list-table-layout';
import {
  buildCardToBinder,
  buildLanguageOptions,
  buildRows,
  gridCaptionFor,
  sortRows,
} from './card-list-table-derive';
import {
  COLLECTION_TABLE_SORTS,
  COLLECTION_VIEW_KEY,
  COLOR_FILTERS,
  GRID_SIZE_KEY,
  RARITIES,
  SORT_FIELD_BY_KEY,
  SORT_KEY_TO_FIELD,
  readStoredCollectionView,
  type GroupKey,
  type Row,
  type SortKey,
  type ViewMode,
} from './card-list-table-config';

interface Props {
  cards: EnrichedCard[];
  binders: MaterializedBinder[];
  /** Map of set code -> set summary (release date, name, icon). Drives "Set" sort. */
  setMap?: SetMap;
  /**
   * When true, the binder filter dropdown is hidden — used when the
   * caller has already scoped `cards` to a single binder, where letting
   * the user "filter by binder" inside that view would just be confusing.
   */
  hideBinderFilter?: boolean;
  /**
   * Opens the Add cards sheet, optionally seeded with a search query. Wired
   * by the Collection page so the empty-collection CTA (no query) and the
   * search hand-off row/tile below (current query) share one entry point
   * without this component needing to know how the sheet is mounted. Omitted
   * in scoped views (e.g. a single binder) that never render either.
   */
  onAddCards?: (query?: string) => void;
  /**
   * A one-shot filter request from an external surface (the Breakdown
   * drawer's insight rows and grouped rows — see
   * `lib/collection/collection-insights.ts`'s `CollectionFilterJump`). Applied by a
   * `useEffect` (not a mount-time read, unlike the `?binder=` deep link
   * above) since the drawer and this table are mounted siblings on the same
   * page — a URL param wouldn't retrigger. Call `onFilterJumpApplied` once
   * consumed so the caller can clear it and the same jump can fire again.
   */
  filterJump?: CollectionFilterJump | null;
  onFilterJumpApplied?: () => void;
}

export function CardListTable({
  cards,
  binders,
  setMap,
  hideBinderFilter = false,
  onAddCards,
  filterJump,
  onFilterJumpApplied,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupKey, setGroupKey] = useState<GroupKey>('none');
  const filters = useCollectionFilters(filterJump, onFilterJumpApplied);
  const { search, setSearch, debouncedSearch, activeFilterCount, activeFilterChips } = filters;
  const { groupPrintings, surplusOnly, oracleTagExpr } = filters.fields;
  // Import history powers the "Date added" sort (timestamp keyed by importId).
  const importHistory = useCollectionStore((s) => s.importHistory);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const pricesEverLoaded = useCollectionStore((s) => s.pricesEverLoaded);
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(SORT_FIELD_BY_KEY[key].defaultDir);
    }
  };
  const [view, setViewRaw] = useState<ViewMode>(readStoredCollectionView);
  const setView = useCallback((v: ViewMode) => {
    setViewRaw(v);
    try {
      localStorage.setItem(COLLECTION_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);
  // Compact rows become the table (aligned columns + sticky sortable header)
  // from tablet width up; on phones twelve columns don't fit, so compact stays
  // the text-only flow row and sort stays in the SortMenu.
  const wideEnoughForTable = useMediaQuery('(min-width: 768px)');
  const phone = useMediaQuery('(max-width: 599px)');
  const isTable = view === 'compact' && wideEnoughForTable;
  const [gridZoom, setGridZoomRaw] = useState(() => readStoredZoom(GRID_SIZE_KEY));
  const setGridZoom = (z: number) => {
    setGridZoomRaw(z);
    try {
      localStorage.setItem(GRID_SIZE_KEY, String(z));
    } catch {
      /* ignore */
    }
  };
  // On narrow viewports the top zoom steps all render as a single
  // full-width column, so the reachable range is capped (without
  // overwriting the stored preference, so it returns when the user
  // resizes back up).
  const isNarrow = useIsNarrow();
  const effectiveZoom = clampZoom(gridZoom, isNarrow);
  // Coarse bucket driving the cell-chrome scaling classes (badges, qty pill).
  const effectiveGridSize = zoomBucket(effectiveZoom);
  const [gridCaptionPrefs, setGridCaptionPrefs] = useGridCaptionPrefs();
  // Rendered caption lines per tile — scales the virtualizer row estimate.
  const gridCaptionLines = (gridCaptionPrefs.sortValue ? 1 : 0) + (gridCaptionPrefs.set ? 1 : 0);
  const subtypeSuggestions = useSubtypeSuggestions(cards);
  // Language filter options — derived from what's actually in the user's
  // collection, not a fixed enum (LANGUAGE_OPTIONS is the full add-card
  // vocabulary, most of which a given collection never uses). Absent
  // language means English, mirroring CardRow's display-chip convention.
  const languageOptions = useMemo(() => buildLanguageOptions(cards), [cards]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  useCollectionHotkeys(setView, onAddCards);

  const cardToBinder = useMemo(() => buildCardToBinder(binders), [binders]);

  // Decorate cards with Scryfall oracle tags only when the live filter uses a
  // tag chip — otherwise this is a zero-cost pass-through (the snapshot isn't
  // even loaded). Needed because the collection matcher reads `card.tags`, and
  // CollectionPage only decorates when an existing binder uses tags.
  const taggedCards = useCardsWithTags(cards, !isExpressionEmpty(oracleTagExpr));
  // Then each printing's own release date, so the Release sort and the Set
  // grouping date a rolling container set (SLD/PLST/PRM/SLP/SLC) per printing
  // rather than from the set. Decorated HERE, upstream of `rows`/`filtered`,
  // so the sort and the section header read the same date — decorating inside
  // the sort memo alone would order rows by printing date under headers still
  // ordered by set date. Pass-through until a price refresh has cached dates.
  const cardsForMatch = useCardsWithReleaseDates(taggedCards, true);

  // Hoisted ahead of `rows`/`filtered` (below, other collection-store reads
  // stay near their non-filter usages further down) so the surplus predicate
  // can run in the same filter pass as the binder/color/condition post-checks.
  const allCards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  // Cubes that list a card without holding a copy (draft cubes, and a physical
  // cube's unreserved picks): the dashed cube badge, never an allocation.
  const cubeListingsFor = useCubeListings();
  // Card names with unallocated copies beyond the keep floor — the
  // "tradeable surplus" predicate. Computed over the full collection (not
  // just `cards`/`cardsForMatch`, which can be a binder-scoped subset) so a
  // spare copy sitting in a different binder still counts.
  const surplusByName = useMemo(
    () => computeSurplusByName(allCards, allocations),
    [allCards, allocations]
  );

  // Where each row's copies are, one place per copy, and each filed copy's
  // page and pocket. `binders` is the unsearched materialization, the one
  // indexCardLocations needs, so the pages match the binder view.
  const copyLocations = useMemo(() => indexCardLocations(binders).byCopyId, [binders]);
  const placesFor = useCallback(
    (r: Row) => breakdownCopies(r.copyIds, allocations, cardToBinder),
    [allocations, cardToBinder]
  );

  const rows = useMemo<Row[]>(
    () => buildRows(cardsForMatch, cardToBinder, groupPrintings),
    [cardsForMatch, cardToBinder, groupPrintings]
  );

  const filtered = useFilteredRows(rows, filters, surplusByName);

  // Import timestamp per importId, for the "Date added" sort (whole-import
  // granularity; cards predating the importId field sort as oldest) and the
  // grid caption's date-added echo.
  const addedAtByImportId = useMemo(
    () => new Map(importHistory.map((e) => [e.id, e.addedAt])),
    [importHistory]
  );

  const sorted = useMemo(
    () => sortRows(filtered, sortKey, sortDir, setMap, addedAtByImportId),
    [filtered, sortKey, sortDir, setMap, addedAtByImportId]
  );
  const {
    displayRows,
    sectionHeaders,
    collapsedKeys,
    toggleCollapsed,
    allSectionKeys,
    allCollapsed,
    toggleAllCollapsed,
  } = useGroupedRows(sorted, groupKey, setMap);

  // Grid caption text — echoes the active sort key's value so any ordering is
  // legible in grid view: dates for the date sorts, rank for the EDHREC sort,
  // otherwise the card's price (the one collector datum the art can't show).
  // Price is unit + pinned USD, matching the sort key and the list rows
  // (purchasePrice is USD-sourced; see CardRow).
  const captionFor = (r: Row): string => gridCaptionFor(r, sortKey, addedAtByImportId, setMap);
  // Card names that appear as more than one printing in the current rows
  // (rows are one-per-printing, so count > 1 = the art alone is ambiguous).
  // Grid tiles for these names grow a small set-code chip so the user can
  // tell the printings apart without opening the preview.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of displayRows) counts.set(r.card.name, (counts.get(r.card.name) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
  }, [displayRows]);

  // Stable parallel arrays for the card preview carousel. Built inline in JSX,
  // these would get a fresh identity on every render — and since each swipe
  // re-renders this component (via onIndexChange → setPreviewIndex), that
  // churned CardPreview's IntersectionObserver (deps: [cards]) on every swipe,
  // re-observing every slide. Memoizing on `displayRows` keeps the reference
  // stable, matching how BinderView feeds its memoized flat arrays.
  const previewCards = useMemo(() => displayRows.map((r) => r.card), [displayRows]);
  const previewSectionLabels = useMemo(
    // Uncategorized is a counted pill from the stack's breakdown (getStackPlaces),
    // not a section word: the word only showed when no copy had a binder.
    () => displayRows.map(() => ''),
    [displayRows]
  );
  const previewPageNumbers = useMemo(() => displayRows.map(() => 0), [displayRows]);

  const {
    selectedRowKeys,
    toggleRow,
    clearSelection,
    selectMode,
    setSelectMode,
    exitSelectMode,
    allSelected,
    selectAll,
    countLabel: bulkCountLabel,
  } = useRowSelection(sorted);
  const allocationsFor = useAllocationsFor(groupPrintings, allCards, allocations);
  const actions = useCollectionRowActions({
    cards,
    allCards,
    allocations,
    groupPrintings,
    selectedRowKeys,
    clearSelection,
  });
  const {
    openEdit,
    handleDeleteRow,
    bulkActions,
    selectedCopyIds,
    confirmDialog,
    editingCard,
    editingSingle,
    editingQty,
    editingMixedDetails,
    deletingRow,
    confirmDeleteCount,
    handleEditConfirm,
  } = actions;
  const { lists, saveToListOpen, setSaveToListOpen, saveToListCards, handleSaveToList } =
    useSaveToList(filtered);

  // Offer the "Add cards" hand-off whenever there's a real query — even with
  // zero collection matches (then the hand-off is the only card/row): a user
  // may own one printing and want another, so a local match is never a
  // reason to hide it. It opens the Add cards sheet on Search with the query
  // pre-filled (C153) rather than a second live-search panel here.
  const showScryfall = debouncedSearch.trim().length >= 2;
  const handoffQuery = debouncedSearch.trim();
  const triggerIndex = displayRows.length;
  // Shared with the zoom column math (lib/util/grid-zoom.ts) and with the deck /
  // list grids' CSS `gap` — the three must agree or the same zoom step
  // renders a different column count on different surfaces.
  const GRID_GAP = GRID_GAP_PX;

  const {
    listContainerRef,
    gridContainerRef,
    controlsRowRef,
    toolbarRowRef,
    tableHeadRef,
    scrollMargin,
    tableHeadH,
    tableHeadTop,
    controlsBottom,
    gridWidth,
    gridCols,
    gridLayout,
    listLayout,
    gridVirtualizer,
    listVirtualizer,
    boundaries,
    activeSectionIdx,
  } = useTableLayout({
    view,
    phone,
    groupKey,
    displayRowCount: displayRows.length,
    showScryfall,
    sortedCount: sorted.length,
    sectionHeaders,
    collapsedKeys,
    effectiveZoom,
    gridCaptionLines,
    resetKey: `${debouncedSearch}|${sortKey}|${sortDir}|${groupKey}|${view}`,
  });

  // One card menu for every layout: the list/table kebab and the grid tile's
  // corner ⋮ offer the same actions, and right-click opens whichever sits on
  // the card under the pointer.
  const cardMenu = (r: Row, variant: 'row' | 'tile') => (
    <CardRowMenu
      card={r.card}
      variant={variant}
      selection={
        selectMode && selectedRowKeys.has(r.key) && selectedRowKeys.size > 1
          ? { title: bulkCountLabel, items: bulkActions }
          : null
      }
      onEditCard={() => openEdit(r.card, !groupPrintings)}
      onSplitCopy={groupPrintings && r.qty >= 2 ? () => openEdit(r.card, true) : undefined}
      onDelete={() => handleDeleteRow(r)}
      currentBinder={
        r.binderId && r.binderName
          ? { id: r.binderId, name: r.binderName, color: r.binderColor }
          : null
      }
    />
  );

  return (
    <div className="card-list">
      {/* Sticky search row — pinned to the top of the list scroll.
          Search + filter icon only; totals and Stats sit in the
          secondary row below so this bar stays compact across every
          breakpoint. */}
      <div ref={toolbarRowRef} className="collection-toolbar-row">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search"
          ariaLabel="Search cards"
          inputId="collection-search"
          trailing={
            <CollectionFiltersDialog
              {...filters.fields}
              subtypeSuggestions={subtypeSuggestions}
              colorOptions={COLOR_FILTERS}
              rarities={RARITIES}
              languages={languageOptions}
              binders={binders}
              hideBinderFilter={hideBinderFilter}
              setMap={setMap}
              activeCount={activeFilterCount}
              rows={rows}
              surplusByName={surplusByName}
              searchTerm={debouncedSearch}
            />
          }
        />
      </div>

      {/* Active filter chips — scrolls with content (non-sticky), appears
          between the search bar and the controls row. One chip per active
          filter group; × on a chip clears just that slice. Only renders
          when at least one filter or search is active. */}
      {activeFilterChips.length > 0 && (
        <FilterChipsRow chips={activeFilterChips} onClearAll={filters.clearAllFilters}>
          {filters.structuredFilterActive && (
            <button
              type="button"
              className="collection-save-as-binder-btn"
              onClick={filters.handleSaveAsBinderClick}
            >
              <Bookmark width={12} height={12} strokeWidth={2} aria-hidden />
              <span>Save as binder</span>
            </button>
          )}
          {saveToListCards.length > 0 && (
            <button
              type="button"
              className="collection-save-as-binder-btn"
              onClick={() => setSaveToListOpen(true)}
            >
              <ListPlus width={12} height={12} strokeWidth={2} aria-hidden />
              <span>Save to list</span>
            </button>
          )}
        </FilterChipsRow>
      )}

      {saveToListOpen && (
        <SaveToListDialog
          cardCount={saveToListCards.length}
          // Dynamic (rule-driven) lists can't take manual entries.
          lists={lists.filter((l) => !l.rule)}
          onSubmit={handleSaveToList}
          onCancel={() => setSaveToListOpen(false)}
        />
      )}

      {/* Sort/group/view controls — sticky beneath the search bar.
          A control row (STYLE_GUIDE "Toolbars & action rows") → flex-wrap,
          never clips. The --z-popover tier matches the search bar so neither
          row "wins" against the other — they form one sticky stack. */}
      <CardListControls
        rowRef={controlsRowRef}
        showResultCount={
          (activeFilterCount > 0 || search.trim() !== '') && sorted.length < rows.length
        }
        sortedCount={sorted.length}
        rowCount={rows.length}
        selectMode={selectMode}
        onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        isNarrow={isNarrow}
        groupKey={groupKey}
        setGroupKey={setGroupKey}
        hasSections={allSectionKeys.length > 0}
        allCollapsed={allCollapsed}
        toggleAllCollapsed={toggleAllCollapsed}
        sortKey={sortKey}
        sortDir={sortDir}
        toggleSort={toggleSort}
        view={view}
        setView={setView}
        effectiveZoom={effectiveZoom}
        gridWidth={gridWidth}
        setGridZoom={setGridZoom}
        gridCaptionPrefs={gridCaptionPrefs}
        setGridCaptionPrefs={setGridCaptionPrefs}
      />

      {selectMode && (
        <CardListBulkToolbar
          selectedCount={selectedRowKeys.size}
          countLabel={bulkCountLabel}
          totalCount={sorted.length}
          allSelected={allSelected}
          actions={bulkActions}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onDone={exitSelectMode}
        />
      )}

      {/* Sticky section overlay — floats below the sticky controls and swaps its
          label as the active section changes on scroll. Tapping it folds/unfolds
          that section, mirroring the inline header. */}
      {groupKey !== 'none' && activeSectionIdx >= 0 && boundaries[activeSectionIdx] && (
        <div
          className="collection-section-sticky-header"
          style={{
            top: controlsBottom > 0 ? controlsBottom + tableHeadH : undefined,
          }}
          aria-hidden
        >
          <SectionHeaderBar
            className="collection-section-sticky-inner"
            tabIndex={-1}
            pip={boundaries[activeSectionIdx].pip}
            label={boundaries[activeSectionIdx].label}
            count={boundaries[activeSectionIdx].count}
            collapsed={collapsedKeys.has(boundaries[activeSectionIdx].key)}
            onToggle={() => toggleCollapsed(boundaries[activeSectionIdx].key)}
          />
        </div>
      )}

      {previewIndex !== null && displayRows[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Collection"
          sectionLabels={previewSectionLabels}
          pageNumbers={previewPageNumbers}
          totalPages={0}
          getStackBinders={(i) => displayRows[i]?.binders ?? []}
          getStackAllocations={(i) => (displayRows[i] ? allocationsFor(displayRows[i].card) : [])}
          getStackCubeListings={(i) =>
            displayRows[i] ? cubeListingsFor(displayRows[i].card.name) : []
          }
          getStackQty={(i) => displayRows[i]?.qty ?? 1}
          getStackPlaces={(i) => (displayRows[i] ? placesFor(displayRows[i]) : undefined)}
          renderPanelExtra={(i) => renderFriendOwners(displayRows[i]?.card)}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onEdit={(c) => {
            setPreviewIndex(null);
            openEdit(c, !groupPrintings);
          }}
        />
      )}

      {cards.length === 0 && !showScryfall ? (
        // Brand-new, never-populated collection — distinct from a filtered
        // "no matches". Same view, just empty: point at the search bar above
        // and offer the Add cards sheet (search · list · scan) right here.
        <EmptyState
          tagline="Your collection is empty."
          hint={'Search to add a card, or tap Add cards.'}
          actions={
            onAddCards && (
              <Button
                variant="primary"
                onClick={() => onAddCards()}
                icon={<Plus width={16} height={16} strokeWidth={1.8} />}
              >
                Add cards
              </Button>
            )
          }
        />
      ) : sorted.length === 0 && !showScryfall ? (
        <EmptyState
          tagline="No matches."
          hint="Try a broader search or fewer filters."
          actions={<Button onClick={filters.clearAllFilters}>Clear filters</Button>}
        />
      ) : view === 'grid' ? (
        <div
          ref={gridContainerRef}
          className="collection-grid"
          style={{
            height: gridVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          <CardListGridRows
            virtualRows={gridVirtualizer.getVirtualItems()}
            layout={gridLayout}
            scrollMargin={scrollMargin}
            cols={gridCols}
            gap={GRID_GAP}
            collapsedKeys={collapsedKeys}
            onToggleSection={toggleCollapsed}
            handoff={
              showScryfall
                ? { index: triggerIndex, query: handoffQuery, onAdd: (q) => onAddCards?.(q) }
                : null
            }
            rowCount={displayRows.length}
            renderCell={(idx) => {
              const r = displayRows[idx];
              return (
                <CardListGridCell
                  key={r.key}
                  row={r}
                  size={effectiveGridSize}
                  caption={gridCaptionPrefs.sortValue ? captionFor(r) : null}
                  captionPrefs={gridCaptionPrefs}
                  selectMode={selectMode}
                  selected={selectedRowKeys.has(r.key)}
                  duplicateNames={duplicateNames}
                  setMap={setMap}
                  surplusOnly={surplusOnly}
                  surplusByName={surplusByName}
                  places={placesFor(r)}
                  cubeListings={cubeListingsFor(r.card.name)}
                  locations={copyLocations}
                  onActivate={() => (selectMode ? toggleRow(r.key) : setPreviewIndex(idx))}
                  menu={cardMenu(r, 'tile')}
                />
              );
            }}
          />
        </div>
      ) : sorted.length === 0 ? null : (
        <CardTableFrame columns={COLLECTION_TABLE_COLUMNS} selectMode={selectMode}>
          {isTable && (
            <CardTableHead<SortKey>
              headRef={tableHeadRef}
              columns={COLLECTION_TABLE_COLUMNS}
              selectMode={selectMode}
              top={tableHeadTop}
              sortFor={COLLECTION_TABLE_SORTS}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              dirLabel={(k, d) => sortDirectionLabel(SORT_KEY_TO_FIELD[k], d)}
            />
          )}
          <div
            ref={listContainerRef}
            className={`collection-list${isTable ? ' is-table' : view === 'compact' ? ' is-compact' : ''}`}
            style={{
              height: listVirtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            <CardListListRows
              virtualRows={listVirtualizer.getVirtualItems()}
              layout={listLayout}
              scrollMargin={scrollMargin}
              measureElement={listVirtualizer.measureElement}
              collapsedKeys={collapsedKeys}
              onToggleSection={toggleCollapsed}
              renderRow={(index) => {
                const r = displayRows[index];
                return (
                  <CardRow
                    card={r.card}
                    qty={r.qty}
                    copyPlaces={{
                      card: r.card,
                      breakdown: placesFor(r),
                      listedIn: cubeListingsFor(r.card.name),
                      locations: copyLocations,
                      interactive: !selectMode,
                    }}
                    surplusCount={surplusOnly ? surplusByName.get(r.card.name) : undefined}
                    setName={r.card.setName || setMap?.[r.card.setCode.toUpperCase()]?.name}
                    isLastRow={index === displayRows.length - 1}
                    selectMode={selectMode}
                    selected={selectedRowKeys.has(r.key)}
                    columns={isTable ? COLLECTION_TABLE_COLUMNS : undefined}
                    pricePending={
                      (isRefreshingPrices || !pricesEverLoaded) &&
                      !((r.card.purchasePrice ?? 0) > 0)
                    }
                    onActivate={() => (selectMode ? toggleRow(r.key) : setPreviewIndex(index))}
                    menu={cardMenu(r, 'row')}
                  />
                );
              }}
            />
          </div>
        </CardTableFrame>
      )}

      {view !== 'grid' && showScryfall && (
        <CardListListHandoff query={handoffQuery} onAdd={() => onAddCards?.(handoffQuery)} />
      )}

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          fallbackCard={printingStubFromEnriched(editingCard)}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={editingSingle ? undefined : editingQty}
          singleCopy={editingSingle}
          details={{
            condition: editingCard.condition,
            language: editingCard.language,
            notes: editingCard.notes,
            altered: editingCard.altered,
            proxy: editingCard.proxy,
            misprint: editingCard.misprint,
            acquiredPrice: editingCard.acquiredPrice,
            priceOverride: editingCard.priceOverride,
          }}
          mixedDetails={editingMixedDetails}
          onConfirm={handleEditConfirm}
          onCancel={actions.closeEdit}
        />
      )}

      {deletingRow && (
        <RemoveCopiesDialog
          cardName={deletingRow.card.name}
          total={deletingRow.total}
          onConfirm={confirmDeleteCount}
          onCancel={actions.closeDeleting}
        />
      )}

      {actions.bulkMoveOpen && (
        <BulkMoveToBinderSheet
          copyIds={selectedCopyIds()}
          cards={allCards.filter((c) => selectedCopyIds().includes(c.copyId))}
          currentBinderByCopyId={
            new Map(
              selectedCopyIds()
                .map((id) => [id, cardToBinder.get(id)?.id] as const)
                .filter((e): e is [string, string] => e[1] !== undefined)
            )
          }
          onClose={() => {
            actions.closeBulkMove();
            clearSelection();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
