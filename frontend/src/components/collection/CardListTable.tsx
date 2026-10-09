import { EmptyState } from '@/components/shared/EmptyState';
import { Bookmark, ListPlus, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollContainer } from '@/lib/util/scroll-container';
import { applyPrices } from '@/lib/collection/card-prices';
import type {
  ChipExpression,
  EnrichedCard,
  MaterializedBinder,
  ScryfallQueryRule,
  SortField,
} from '@/types/index';
import type { SetMap } from '@/lib/api';
import { CardRowMenu } from './CardRowMenu';
import type { OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { CardPreview } from '@/components/card/CardPreview';
import { renderFriendOwners } from '@/components/trade/FriendOwnersPanel';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { RemoveCopiesDialog } from './RemoveCopiesDialog';
import { BulkMoveToBinderSheet } from '@/components/binder/BulkMoveToBinderSheet';
import { useConfirm } from '@/components/overlays/use-confirm';
import { removeCopiesOfPrinting, printingFinishKey } from '@/lib/collection/collection-mutations';
import { useToastsStore } from '@/store/toasts';
import { useRegisterShortcuts, isTypingTarget } from '@/components/app-shell/shortcut-registry';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import { useCubeListings } from '@/lib/cube/cube-listings';
import type { CollectionFilterJump } from '@/lib/collection/collection-insights';
import {
  GRID_GAP_PX,
  clampZoom,
  readStoredZoom,
  zoomBucket,
  zoomCols,
  zoomTier,
} from '@/lib/util/grid-zoom';
import { SearchPill } from '@/components/search/SearchPill';
import { CollectionFiltersDialog } from '@/components/search/CollectionFiltersDialog';
import { SaveToListDialog } from '@/components/lists/SaveToListDialog';
import { useCardsWithTags } from '@/lib/cards/card-tags';
import { useCardsWithReleaseDates } from '@/lib/cards/card-release-dates';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import { sortDirectionLabel } from '@/lib/search/sorting';
import { getSectionMeta } from '@spellcontrol/binder-routing';
import {
  groupRowsIntoSections,
  buildGridLayout,
  buildListLayout,
  type SectionHeader,
  type GridLayoutRow,
  type ListLayoutRow,
} from '@/lib/collection/group-sections';
import { type ColorMatchMode } from '@/lib/cards/colors';
import { rowMatchesCollectionFilter } from '@/lib/search/collection-filter';
import { useCollectionStore } from '@/store/collection';
import {
  collectionFiltersToFilterGroup,
  deriveBinderName,
  hasStructuredFilter,
} from '@/lib/search/collection-filters-to-binder';
import { CardRow } from '@/components/shared/CardRow';
import { SectionHeaderBar } from '@/components/shared/SectionHeaderBar';
import {
  CardTableFrame,
  CardTableHead,
  COLLECTION_TABLE_COLUMNS,
} from '@/components/shared/CardTable';
import {
  GRID_CAPTION_H,
  GRID_CAPTION_PLATE_PAD,
  useGridCaptionPrefs,
} from '@/components/shared/CardGridCell';
import { FilterChipsRow, type FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
import {
  buildEditedCards,
  isNoOpCardEdit,
  stackCopies,
  stackDetailMix,
  printingStubFromEnriched,
} from '@/lib/collection/edit-card';
import { compileExpression, compileFilter, isExpressionEmpty } from '@/lib/binder/rules';
import { Button } from '@/components/shared/Button';
import { CardListBulkToolbar } from './CardListBulkToolbar';
import { CardListControls } from './CardListControls';
import { CardListGridCell } from './CardListGridCell';
import { CardListGridRows, CardListListHandoff, CardListListRows } from './CardListVirtualRows';
import { buildActiveFilterChips } from './card-list-filter-chips';
import { useAllocationsFor, useIsNarrow, useSubtypeSuggestions } from './card-list-table-hooks';
import {
  buildCardToBinder,
  buildLanguageOptions,
  buildMatchFilter,
  buildRows,
  gridCaptionFor,
  sortRows,
} from './card-list-table-derive';
import {
  COLLECTION_SHORTCUTS,
  COLLECTION_TABLE_SORTS,
  COLLECTION_VIEW_KEY,
  COLOR_FILTERS,
  GRID_SECTION_HEADER_H,
  GRID_SIZE_KEY,
  GROUP_KEY_TO_FIELD,
  RARITIES,
  listRowEstimate,
  SORT_FIELD_BY_KEY,
  SORT_KEY_TO_FIELD,
  loadCollapsedKeys,
  persistCollapsedKeys,
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
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupKey, setGroupKey] = useState<GroupKey>('none');
  // Collapsed section keys for the active group field, persisted per field so the
  // fold state survives reloads. Reloaded whenever the grouping changes.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => loadCollapsedKeys('none'));
  useEffect(() => {
    setCollapsedKeys(loadCollapsedKeys(groupKey));
  }, [groupKey]);
  const toggleCollapsed = useCallback(
    (key: string) => {
      setCollapsedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistCollapsedKeys(groupKey, next);
        return next;
      });
    },
    [groupKey]
  );
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
  const setView = (v: ViewMode) => {
    setViewRaw(v);
    try {
      localStorage.setItem(COLLECTION_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
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
  // Deep-link: /collection?binder=<name> seeds the binder filter at mount.
  // `__uncategorized` is the value the filter dialog itself uses for the
  // fallthrough pile, so the post-import "matched no binder" row (E296) can
  // hand the user straight to the cards that escaped every rule. Captured in
  // the lazy initializer (like CollectionPage's `?add=`) so it survives the
  // param being stripped from the URL on the next line.
  const [searchParams, setSearchParams] = useSearchParams();
  const [binderExpr, setBinderExpr] = useState<ChipExpression>(() => {
    const seed = searchParams.get('binder');
    return seed
      ? { chips: [{ value: seed, negate: false }], joiners: [] }
      : { chips: [], joiners: [] };
  });
  useEffect(() => {
    if (searchParams.get('binder') === null) return;
    // Strip without a history entry so a refresh doesn't silently re-apply a
    // filter the user has since cleared.
    const next = new URLSearchParams(searchParams);
    next.delete('binder');
    setSearchParams(next, { replace: true });
    // Mount only — the value is already captured in state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Default ON: a collection reads as "what printings do I own and how
  // many?" — the rolled-up qty pill matches that mental model. Power
  // users who want to see every physical copy individually can toggle.
  const [groupPrintings, setGroupPrintings] = useState(true);
  // Tradeable-surplus filter: rows whose card name has ≥1 unallocated copy
  // beyond the keep floor (see computeSurplusByName). Independent of
  // groupPrintings — works whether rows are per-printing or per-copy.
  const [surplusOnly, setSurplusOnly] = useState(false);
  const [proxyOnly, setProxyOnly] = useState(false);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMatchMode>('any');
  const [supertypeExpr, setSupertypeExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [typesExpr, setTypesExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [subtypeExpr, setSubtypeExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const subtypeSuggestions = useSubtypeSuggestions(cards);
  // Language filter options — derived from what's actually in the user's
  // collection, not a fixed enum (LANGUAGE_OPTIONS is the full add-card
  // vocabulary, most of which a given collection never uses). Absent
  // language means English, mirroring CardRow's display-chip convention.
  const languageOptions = useMemo(() => buildLanguageOptions(cards), [cards]);
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [oracleTagExpr, setOracleTagExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [scryfallQuery, setScryfallQuery] = useState<ScryfallQueryRule | undefined>(undefined);
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [borderExpr, setBorderExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [finishExpr, setFinishExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [conditionExpr, setConditionExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [languageExpr, setLanguageExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
  const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
  const [cmcMin, setCmcMin] = useState<number | undefined>(undefined);
  const [cmcMax, setCmcMax] = useState<number | undefined>(undefined);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Bulk selection is keyed by row.key (the grouped printing+finish key, or a
  // copyId when grouping is off) — the same identity the row template renders
  // and the same one handleDeleteRow resolves to underlying copies. Each
  // selected row is expanded to its physical copyIds only at move time.
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedRowKeys(new Set()), []);
  // Selection is a deliberate mode the user opts into (toggle in the toolbar),
  // not an always-on affordance: rows/cards stay clean until "Select" is on,
  // then a row/card click toggles its selection instead of opening preview.
  const [selectMode, setSelectMode] = useState(false);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearSelection();
  }, [clearSelection]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const toolbarRowRef = useRef<HTMLDivElement>(null);

  // The window no longer scrolls — .app-main is the scroll container. The
  // virtualized list lives below the hero/search/toolbar inside it, so the
  // virtualizer needs that leading offset (scrollMargin) to map scroll
  // position to row index. Measured from rects so it's agnostic to which
  // wrappers are positioned and to toolbar reflow.
  const scrollEl = useScrollContainer();
  const [scrollMargin, setScrollMargin] = useState(0);
  // Sticky table header (compact view, tablet+). Its height is measured, not
  // a constant, because it grows to the touch floor on coarse pointers; the
  // section overlay pins below it.
  const tableHeadRef = useRef<HTMLDivElement>(null);
  const [tableHeadH, setTableHeadH] = useState(0);
  // Where the header pins: the bottom edge of the lowest STICKY chrome bar
  // once it is pinned — its own `top` plus its height — not its unscrolled
  // position. `controlsBottom` is only re-measured while grouped (the section
  // overlay's scroll handler), so at scrollTop 0 it still holds the
  // pre-pin offset and the header would stick mid-list. Bars that aren't
  // sticky (phones, short landscape) contribute nothing.
  const [tableHeadTop, setTableHeadTop] = useState(0);
  // Measured bottom of the lowest pinned chrome bar relative to the scroll
  // container top — used as the `top` for the sticky section overlay so it
  // sits flush below the sticky stack regardless of filter-chip row height.
  // On phones the controls row is not sticky (scrolls away; see
  // collection.css), so the pin line falls back to the search row's bottom —
  // hence the max() over both bars wherever this is measured.
  const [controlsBottom, setControlsBottom] = useState(0);
  // Bottom edge of the lowest chrome bar still in view (viewport-relative,
  // offset by the scrollport top). The max() picks the controls row while it
  // is visible/pinned and the search row once the controls have scrolled away.
  const chromeBottom = useCallback((scrollRectTop: number) => {
    const ctrl = controlsRowRef.current;
    const bar = toolbarRowRef.current;
    return Math.max(
      ctrl ? ctrl.getBoundingClientRect().bottom - scrollRectTop : 0,
      bar ? bar.getBoundingClientRect().bottom - scrollRectTop : 0
    );
  }, []);

  // Global hotkeys while the table is mounted. We ignore key events when the
  // user is typing into an input/textarea/contenteditable so the shortcuts
  // don't fight with normal text entry.
  // NOTE: `?` is handled globally by Layout's ShortcutRegistryProvider.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === '/') {
        const el = document.getElementById('collection-search');
        if (el instanceof HTMLInputElement) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }
      if (e.key === 'g') {
        e.preventDefault();
        setView('grid');
        return;
      }
      if (e.key === 'l') {
        e.preventDefault();
        setView('list');
        return;
      }
      if (e.key === 'c') {
        e.preventDefault();
        setView('compact');
        return;
      }
      if (e.key === 'a') {
        e.preventDefault();
        onAddCards?.();
        return;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onAddCards]);

  // Register the Collection shortcut section while this table is mounted.
  // The `?` overlay is owned by Layout; we contribute our shortcuts to the
  // registry so they appear under the "Collection" section automatically.
  useRegisterShortcuts('Collection', COLLECTION_SHORTCUTS);

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

  const rows = useMemo<Row[]>(
    () => buildRows(cardsForMatch, cardToBinder, groupPrintings),
    [cardsForMatch, cardToBinder, groupPrintings]
  );

  // Binder membership and condition are collection-only post-checks that don't
  // map directly to BinderFilter fields, so they're compiled separately.
  const compiledBinder = useMemo(() => compileExpression(binderExpr), [binderExpr]);
  const compiledCondition = useMemo(() => compileExpression(conditionExpr), [conditionExpr]);
  const compiledLanguage = useMemo(() => compileExpression(languageExpr), [languageExpr]);

  // Build a BinderFilter from all the non-collection-specific filter state and
  // let the engine handle matching — eliminates the 11 individual compilations
  // and the hand-rolled per-field checks from the old filtered useMemo.
  const compiledMatchFilter = useMemo(
    () =>
      compileFilter(
        buildMatchFilter({
          supertypeExpr,
          typesExpr,
          subtypeExpr,
          rarityExpr,
          oracleExpr,
          oracleTagExpr,
          scryfallQuery,
          legalityExpr,
          layoutExpr,
          treatmentExpr,
          borderExpr,
          finishExpr,
          setFilter,
          priceMin,
          priceMax,
          cmcMin,
          cmcMax,
          debouncedSearch,
        })
      ),
    [
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      rarityExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      debouncedSearch,
    ]
  );

  // The predicate itself lives in lib/search/collection-filter so the Filters dialog
  // can run the identical thing over its DRAFT state for a live match count.
  const filterCriteria = useMemo(
    () => ({
      matchFilter: compiledMatchFilter,
      binder: compiledBinder,
      colors: colorFilter,
      colorMode,
      condition: compiledCondition,
      language: compiledLanguage,
      surplusOnly,
      surplusByName,
      proxyOnly,
    }),
    [
      compiledMatchFilter,
      compiledBinder,
      colorFilter,
      colorMode,
      compiledCondition,
      compiledLanguage,
      surplusOnly,
      surplusByName,
      proxyOnly,
    ]
  );

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesCollectionFilter(r, filterCriteria)),
    [rows, filterCriteria]
  );

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

  // "Group by" re-buckets the already-sorted rows under per-attribute section
  // headers. We stable-group `sorted` (within-group order = the user's sort) so
  // grouping composes with sorting. Applies to all three views — list/compact
  // render headers inline in the boundary row's measured cell, grid renders them
  // as full-width rows via `gridLayout` below. Everything downstream (the
  // carousel, the add-handoff trigger index, the virtualizers) indexes off
  // `displayRows`, never `sorted`.
  const groupField: SortField | null = groupKey !== 'none' ? GROUP_KEY_TO_FIELD[groupKey] : null;
  const { displayRows, sectionHeaders } = useMemo<{
    displayRows: Row[];
    sectionHeaders: Map<number, SectionHeader> | null;
  }>(() => {
    if (!groupField) return { displayRows: sorted, sectionHeaders: null };
    const { rows: grouped, headers } = groupRowsIntoSections(sorted, (r) =>
      getSectionMeta(r.card, groupField, { setMap })
    );
    return { displayRows: grouped, sectionHeaders: headers };
  }, [sorted, groupField, setMap]);

  // Grid caption text — echoes the active sort key's value so any ordering is
  // legible in grid view: dates for the date sorts, rank for the EDHREC sort,
  // otherwise the card's price (the one collector datum the art can't show).
  // Price is unit + pinned USD, matching the sort key and the list rows
  // (purchasePrice is USD-sourced; see CardRow).
  const captionFor = (r: Row): string => gridCaptionFor(r, sortKey, addedAtByImportId, setMap);

  // Every section key in the current grouping, for the collapse-all/expand-all
  // toggle. Empty when ungrouped.
  const allSectionKeys = useMemo(
    () => (sectionHeaders ? [...sectionHeaders.values()].map((h) => h.meta.key) : []),
    [sectionHeaders]
  );
  const allCollapsed =
    allSectionKeys.length > 0 && allSectionKeys.every((k) => collapsedKeys.has(k));
  const toggleAllCollapsed = useCallback(() => {
    const next = allCollapsed ? new Set<string>() : new Set(allSectionKeys);
    setCollapsedKeys(next);
    persistCollapsedKeys(groupKey, next);
  }, [allCollapsed, allSectionKeys, groupKey]);

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
    () => displayRows.map((r) => (r.binders.length === 0 ? 'Uncategorized' : '')),
    [displayRows]
  );
  const previewPageNumbers = useMemo(() => displayRows.map(() => 0), [displayRows]);

  // "Select all" is scoped to the rows currently shown (post-search/filter),
  // not the whole collection — selecting things you can't see would be a
  // footgun for the bulk delete/move actions. allSelected drives the toggle
  // label so one button both selects and clears the visible set.
  const allSelected = useMemo(
    () => sorted.length > 0 && sorted.every((r) => selectedRowKeys.has(r.key)),
    [sorted, selectedRowKeys]
  );
  const selectAll = useCallback(() => {
    setSelectedRowKeys(new Set(sorted.map((r) => r.key)));
  }, [sorted]);

  // Scroll to top when filters, sort, or view mode change.
  const resetKey = `${debouncedSearch}|${sortKey}|${sortDir}|${groupKey}|${view}`;
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      scrollEl?.scrollTo({ top: 0 });
    }
  }, [resetKey, scrollEl]);

  // Grid: measure the container so column count (for row-of-columns
  // virtualization) and the zoom stepper's reachable range both derive from
  // the same width. The gap used to be a local 8/10 literal that disagreed
  // with the 10px this grid actually renders with — `zoomCols` owns it now.
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el || view !== 'grid') return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const gridCols = gridWidth > 0 ? zoomCols(effectiveZoom, zoomTier(gridWidth), gridWidth) : 4;

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

  // Heterogeneous grid row list: full-width section headers interleaved with
  // chunked card rows. The "Add cards" hand-off rides as one trailing item.
  const gridLayout = useMemo<GridLayoutRow[]>(
    () =>
      view === 'grid'
        ? buildGridLayout(
            displayRows.length,
            gridCols,
            sectionHeaders,
            showScryfall ? 1 : 0,
            collapsedKeys
          )
        : [],
    [view, displayRows.length, gridCols, sectionHeaders, showScryfall, collapsedKeys]
  );

  // List/compact mirror of `gridLayout`: header rows interleaved with one row
  // per card, collapsed sections folding to their header. Headers ride as their
  // own virtual rows (not inside the first card) so a folded section keeps a
  // tappable header with zero card rows below it.
  const listLayout = useMemo<ListLayoutRow[]>(
    () =>
      view === 'grid' ? [] : buildListLayout(displayRows.length, sectionHeaders, collapsedKeys),
    [view, displayRows.length, sectionHeaders, collapsedKeys]
  );

  // Per-index height estimate: section headers are a fixed short row, card rows
  // derive from the live column width (exact aspect ratio), so the grid stays
  // measureElement-free — the estimate is the truth and offsets never drift.
  const estimateGridRowHeight = useCallback(
    (index: number) => {
      if (gridLayout[index]?.kind === 'header') return GRID_SECTION_HEADER_H;
      if (!gridContainerRef.current) return 250;
      const w = gridContainerRef.current.clientWidth;
      const colWidth = (w - GRID_GAP * (gridCols - 1)) / gridCols;
      return (
        colWidth * (680 / 488) +
        GRID_CAPTION_H * gridCaptionLines +
        (gridCaptionLines > 0 ? GRID_CAPTION_PLATE_PAD : 0) +
        GRID_GAP
      );
    },
    [gridCols, gridLayout, gridCaptionLines]
  );

  useLayoutEffect(() => {
    if (!scrollEl) return;
    const measure = () => {
      const el = view === 'grid' ? gridContainerRef.current : listContainerRef.current;
      if (!el) return;
      const scrollRect = scrollEl.getBoundingClientRect();
      const top = el.getBoundingClientRect().top - scrollRect.top + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - top) > 0.5 ? top : prev));
      // Measure the pinned chrome's bottom so the overlay sits snug below it.
      const bottom = chromeBottom(scrollRect.top);
      if (bottom > 0) {
        setControlsBottom((prev) => (Math.abs(prev - bottom) > 0.5 ? bottom : prev));
      }
      setTableHeadH(tableHeadRef.current?.offsetHeight ?? 0);
      const pinnedBottom = (el: HTMLElement | null) => {
        if (!el) return 0;
        const cs = getComputedStyle(el);
        const top = parseFloat(cs.top);
        // −1px: every bar in this sticky stack overlaps the one above it by a
        // pixel so DPR rounding can't open a seam for rows to scroll through
        // (see the `.collection-toolbar-row` / `.card-list-controls-sticky`
        // rules). The table header is part of the same stack and needs it too:
        // without it the header landed +0.4px below the controls row and a
        // sliver of the list showed between them on fractional-DPR displays.
        return cs.position === 'sticky' && Number.isFinite(top) ? top + el.offsetHeight - 1 : 0;
      };
      setTableHeadTop(
        Math.max(pinnedBottom(controlsRowRef.current), pinnedBottom(toolbarRowRef.current))
      );
    };
    measure();
    // The chrome rows are observed alongside the scrollport: the controls row
    // changes height on its own (wrapping at narrow widths, the result count
    // appearing once a filter narrows the set, select mode swapping in the
    // bulk bar) without the scroll container ever resizing. Observing only
    // the scrollport left `tableHeadTop` stamped at the mount-time height —
    // measured 12px too low after a shrink, which parks the header below the
    // controls row with a live gap, and 26px too high after a growth, which
    // tucks it underneath.
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    if (controlsRowRef.current) ro.observe(controlsRowRef.current);
    if (toolbarRowRef.current) ro.observe(toolbarRowRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollEl, view, gridCols, sorted.length, chromeBottom]);

  // Header rows are short; card rows fall back to the per-view estimate. Exact
  // heights still come from measureElement, so the estimate only seeds layout.
  const estimateListRowHeight = useCallback(
    (index: number) => {
      if (listLayout[index]?.kind === 'header') return GRID_SECTION_HEADER_H;
      return listRowEstimate(view === 'compact' ? 'compact' : 'list', phone);
    },
    [listLayout, view, phone]
  );

  const listVirtualizer = useVirtualizer({
    count: view !== 'grid' ? listLayout.length : 0,
    getScrollElement: () => scrollEl,
    estimateSize: estimateListRowHeight,
    overscan: 20,
    scrollMargin,
  });

  const gridVirtualizer = useVirtualizer({
    count: gridLayout.length,
    getScrollElement: () => scrollEl,
    estimateSize: estimateGridRowHeight,
    overscan: 8,
    scrollMargin,
  });

  // The grid is measureElement-free (the estimate is the truth), so cached row
  // heights must be dropped when the caption toggles or they'd drift by
  // GRID_CAPTION_H per row.
  useEffect(() => {
    gridVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCaptionLines]);

  // Fallback pin line (px) for the active-section trigger, used only until the
  // sticky controls' bottom has been measured. Roughly one header's height.
  const OVERLAY_H = 40;

  // Flat sorted array of section boundary pixel offsets, recomputed whenever
  // the layout changes. Each entry maps to a section's label, count, and pip.
  type BoundaryEntry = {
    key: string;
    label: string;
    count: number;
    pip: SectionHeader['meta']['pip'];
    start: number;
  };
  const boundaries = useMemo<BoundaryEntry[]>(() => {
    if (groupKey === 'none') return [];
    const out: BoundaryEntry[] = [];
    if (view !== 'grid') {
      for (let li = 0; li < listLayout.length; li++) {
        const item = listLayout[li];
        if (item.kind === 'header') {
          const start = listVirtualizer.measurementsCache?.[li]?.start ?? 0;
          out.push({
            key: item.meta.key,
            label: item.meta.label,
            count: item.count,
            pip: item.meta.pip,
            start,
          });
        }
      }
    } else {
      for (let gi = 0; gi < gridLayout.length; gi++) {
        const layoutRow = gridLayout[gi];
        if (layoutRow.kind === 'header') {
          const start = gridVirtualizer.measurementsCache?.[gi]?.start ?? 0;
          out.push({
            key: layoutRow.meta.key,
            label: layoutRow.meta.label,
            count: layoutRow.count,
            pip: layoutRow.meta.pip,
            start,
          });
        }
      }
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }, [
    groupKey,
    view,
    listLayout,
    gridLayout,
    listVirtualizer.measurementsCache,
    gridVirtualizer.measurementsCache,
  ]);

  // Active section index into `boundaries` (-1 = overlay not shown).
  const [activeSectionIdx, setActiveSectionIdx] = useState(-1);

  // Update active section on scroll. Also re-measures the controls row's bottom
  // here: the useLayoutEffect measure runs at scrollTop 0, where the controls
  // sit at their natural position *below* the non-sticky filter-chips row, so
  // that reading overshoots by whatever scrolls away above the pinned bar. Once
  // scrolled (when the overlay is actually shown) the controls are pinned and
  // `rect.bottom` is the true sticky offset the overlay must clear.
  useEffect(() => {
    if (!scrollEl || groupKey === 'none' || boundaries.length === 0) {
      setActiveSectionIdx(-1);
      return;
    }
    const onScroll = () => {
      // The pin line is the bottom of the lowest chrome bar still in view,
      // measured live so it tracks the full stack height — not the overlay's
      // own height. A section becomes active the moment its header reaches
      // that line; using OVERLAY_H here instead left a dead zone where the
      // header had slid up behind the taller controls but the overlay had
      // not yet appeared. Re-measured here (vs the scrollTop-0 layout effect)
      // because only once scrolled is the chrome actually pinned. On phones
      // the controls row is not sticky, so once it scrolls away chromeBottom
      // hands the pin line to the search row.
      let pin = chromeBottom(scrollEl.getBoundingClientRect().top);
      if (pin > 0) {
        setControlsBottom((prev) => (Math.abs(prev - pin) > 0.5 ? pin : prev));
      } else {
        pin = OVERLAY_H; // fallback while the chrome rows aren't mounted
      }
      const raw = scrollEl.scrollTop - scrollMargin + pin;
      let active = -1;
      for (let i = 0; i < boundaries.length; i++) {
        if (boundaries[i].start <= raw) active = i;
        else break;
      }
      setActiveSectionIdx(active);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    // Run once immediately to sync with current scroll position.
    onScroll();
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [scrollEl, groupKey, boundaries, scrollMargin, chromeBottom]);

  // Reset when grouping is turned off.
  useEffect(() => {
    if (groupKey === 'none') setActiveSectionIdx(-1);
  }, [groupKey]);

  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  // True when the edit targets a single physical copy rather than the whole
  // printing stack: always so in ungrouped view, and when "Change one copy's
  // printing" is picked from a grouped 2+ stack (splitting one copy off).
  const [editingSingle, setEditingSingle] = useState(false);
  const openEdit = (card: EnrichedCard, single: boolean) => {
    setEditingCard(card);
    setEditingSingle(single);
  };
  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return cards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, cards]);
  // Only meaningful for a grouped (stacked) edit — a single-copy edit is
  // trivially uniform. Mirrors the exact scryfallId+finish match
  // buildEditedCards edits by, so "mixed" here means buildEditedCards would
  // otherwise touch more than one distinct condition/language.
  const editingMixedDetails = useMemo(() => {
    if (!editingCard || editingSingle) return undefined;
    return stackDetailMix(stackCopies(allCards, editingCard));
  }, [editingCard, editingSingle, allCards]);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const lists = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const addListEntries = useCollectionStore((s) => s.addListEntries);
  const [saveToListOpen, setSaveToListOpen] = useState(false);
  const allocationsFor = useAllocationsFor(groupPrintings, allCards, allocations);

  const pushToast = useToastsStore((s) => s.push);

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    // Single-copy edit re-points just this one copy, leaving siblings on the old
    // printing — that's how a stack of identical printings gets split.
    const copyId = editingSingle ? editingCard.copyId : undefined;
    if (isNoOpCardEdit(editingCard, selection, editingQty, copyId)) {
      setEditingCard(null);
      return;
    }
    const prevCards = allCards;
    const cardName = editingCard.name;
    replaceAllCards(buildEditedCards(editingCard, selection, allCards, copyId));
    pushToast({
      message: `Updated ${cardName}.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => replaceAllCards(prevCards),
    });
    setEditingCard(null);
  };

  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  // For stacked rows (qty > 1, grouped view), the user picks how many to drop.
  const [deletingRow, setDeletingRow] = useState<{
    card: EnrichedCard;
    key: string;
    total: number;
  } | null>(null);

  // Restore by appending the exact removed copies (copyIds preserved) to the
  // current collection — replaceAllCards re-runs remapAllocations so any deck
  // that lost a binding rebinds.
  const applyRemoval = useCallback(
    (removed: EnrichedCard[]) => {
      if (removed.length === 0) return;
      const removedIds = new Set(removed.map((c) => c.copyId));
      replaceAllCards(allCards.filter((c) => !removedIds.has(c.copyId)));
      // Naming a card only reads correctly when they are all the same card —
      // the per-row and RemoveCopiesDialog paths. A bulk selection spans many
      // printings, and "Removed 500 copies of Finch Formation" is simply wrong.
      const names = new Set(removed.map((c) => c.name));
      const what =
        names.size === 1
          ? `${removed.length} ${removed.length === 1 ? 'copy' : 'copies'} of ${removed[0].name}`
          : `${removed.length} cards`;
      pushToast({
        message: `Removed ${what}`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => replaceAllCards([...useCollectionStore.getState().cards, ...removed]),
      });
    },
    [allCards, replaceAllCards, pushToast]
  );

  const handleDeleteRow = useCallback(
    (row: Row) => {
      // Ungrouped view: a row is one physical copy — remove exactly it.
      if (!groupPrintings) {
        applyRemoval([row.card]);
        return;
      }
      const key = printingFinishKey(row.card);
      const total = allCards.filter((c) => printingFinishKey(c) === key).length;
      if (total <= 1) {
        applyRemoval(removeCopiesOfPrinting(allCards, key, 1, allocatedCopyIds).removed);
        return;
      }
      setDeletingRow({ card: row.card, key, total });
    },
    [groupPrintings, allCards, allocatedCopyIds, applyRemoval]
  );

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

  const confirmDeleteCount = useCallback(
    (count: number) => {
      if (!deletingRow) return;
      const { removed } = removeCopiesOfPrinting(
        allCards,
        deletingRow.key,
        count,
        allocatedCopyIds
      );
      applyRemoval(removed);
      setDeletingRow(null);
    },
    [deletingRow, allCards, allocatedCopyIds, applyRemoval]
  );

  // Expand the row-keyed selection into concrete physical copyIds. When
  // grouping is on, each key is a printing+finish key that fans out to every
  // matching copy in the full collection (same idiom handleDeleteRow uses);
  // when grouping is off the key already IS a copyId. Deduped.
  const selectedCopyIds = useCallback((): string[] => {
    const ids = new Set<string>();
    for (const key of selectedRowKeys) {
      if (groupPrintings) {
        for (const c of allCards) {
          if (printingFinishKey(c) === key) ids.add(c.copyId);
        }
      } else {
        ids.add(key);
      }
    }
    return [...ids];
  }, [selectedRowKeys, groupPrintings, allCards]);

  const handleBulkDelete = useCallback(async () => {
    const ids = selectedCopyIds();
    const idSet = new Set(ids);
    const removable = allCards.filter(
      (c) => idSet.has(c.copyId) && !allocatedCopyIds.has(c.copyId)
    );
    const skipped = ids.length - removable.length;
    const ok = await confirm({
      title: `Delete ${removable.length} selected ${removable.length === 1 ? 'copy' : 'copies'}?`,
      body:
        skipped > 0
          ? `${skipped} ${skipped === 1 ? 'copy' : 'copies'} reserved by a deck will be kept. This can be undone.`
          : `The selected copies will be removed from your collection. This can be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok || removable.length === 0) return;
    applyRemoval(removable);
    clearSelection();
  }, [selectedCopyIds, allCards, allocatedCopyIds, confirm, applyRemoval, clearSelection]);

  // Smart toggle (mirrors the "Select all"/"Deselect all" pill above): marks
  // every selected copy as proxy, unless they're ALL already proxy, in which
  // case it unmarks. Non-destructive and instantly reversible (Undo toast),
  // so this skips the blocking confirm() that guards handleBulkDelete — that
  // bar is for data loss, not a flag flip. applyPrices re-runs inline so the
  // collection total reflects the price zeroing immediately, the same
  // chokepoint refreshPrices/reapplyCardPrices use (lib/collection/card-prices.ts).
  const bulkProxyAllMarked = useMemo(() => {
    if (selectedRowKeys.size === 0) return false;
    const ids = new Set(selectedCopyIds());
    const targets = allCards.filter((c) => ids.has(c.copyId));
    return targets.length > 0 && targets.every((c) => c.proxy);
  }, [selectedRowKeys, selectedCopyIds, allCards]);

  const handleBulkToggleProxy = useCallback(() => {
    const ids = selectedCopyIds();
    const idSet = new Set(ids);
    const targets = allCards.filter((c) => idSet.has(c.copyId));
    if (targets.length === 0) return;
    const nextProxy = !bulkProxyAllMarked;
    const prevCards = allCards;
    const next = applyPrices(
      allCards.map((c) =>
        idSet.has(c.copyId) ? { ...c, proxy: nextProxy, updatedAt: Date.now() } : c
      )
    );
    replaceAllCards(next);
    pushToast({
      message: `${nextProxy ? 'Marked' : 'Unmarked'} ${targets.length} ${
        targets.length === 1 ? 'copy' : 'copies'
      } as proxy.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => replaceAllCards(applyPrices(prevCards)),
    });
  }, [selectedCopyIds, allCards, bulkProxyAllMarked, replaceAllCards, pushToast]);

  // Count active filter *groups*, not individual chips — five colors
  // selected is still one filter group, so the badge stays glanceable.
  const activeFilterCount =
    (!isExpressionEmpty(supertypeExpr) ? 1 : 0) +
    (!isExpressionEmpty(typesExpr) ? 1 : 0) +
    (!isExpressionEmpty(subtypeExpr) ? 1 : 0) +
    (colorFilter.size > 0 ? 1 : 0) +
    (!isExpressionEmpty(rarityExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleTagExpr) ? 1 : 0) +
    (scryfallQuery ? 1 : 0) +
    (!isExpressionEmpty(legalityExpr) ? 1 : 0) +
    (!isExpressionEmpty(layoutExpr) ? 1 : 0) +
    (!isExpressionEmpty(treatmentExpr) ? 1 : 0) +
    (!isExpressionEmpty(borderExpr) ? 1 : 0) +
    (!isExpressionEmpty(finishExpr) ? 1 : 0) +
    (!isExpressionEmpty(conditionExpr) ? 1 : 0) +
    (!isExpressionEmpty(languageExpr) ? 1 : 0) +
    (!isExpressionEmpty(binderExpr) ? 1 : 0) +
    (setFilter.size > 0 ? 1 : 0) +
    (priceMin !== undefined || priceMax !== undefined ? 1 : 0) +
    (cmcMin !== undefined || cmcMax !== undefined ? 1 : 0) +
    (groupPrintings ? 0 : 1) +
    (surplusOnly ? 1 : 0) +
    (proxyOnly ? 1 : 0);

  // Empty chip expression reused for clearing chip-based filters.
  // Stable reference (same shape every time) — memoized so the
  // chips useMemo dependency doesn't trigger on every render.
  const EMPTY_EXPR = useMemo<ChipExpression>(() => ({ chips: [], joiners: [] }), []);

  // Whether at least one STRUCTURED filter (not just a search term) is active.
  // Used to gate the "Save as binder" button.
  // Note: condition, language, and binder filters are deliberately excluded from
  // hasStructuredFilter because they can't be mapped to a binder rule — so those
  // filters alone won't enable the button.
  const structuredFilterActive = hasStructuredFilter({
    colorFilter,
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    scryfallQuery,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    conditionExpr,
    languageExpr,
    binderExpr,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    search,
  });

  const handleSaveAsBinderClick = useCallback(() => {
    const filterInput = {
      colorFilter,
      colorMode,
      proxyOnly,
      surplusOnly,
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      rarityExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      conditionExpr,
      languageExpr,
      binderExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      search,
    };
    const { group, flagged } = collectionFiltersToFilterGroup(filterInput);
    const name = deriveBinderName(filterInput);
    setEditingBinder('new', { name, groups: [group], flagged });
  }, [
    colorFilter,
    colorMode,
    proxyOnly,
    surplusOnly,
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    scryfallQuery,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    conditionExpr,
    languageExpr,
    binderExpr,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    search,
    setEditingBinder,
  ]);

  // Aggregate the current filter result into one entry per printing+finish
  // (summing copies), independent of the group-printings toggle — that's the
  // set "Save to list" captures.
  const saveToListCards = useMemo(() => {
    const byKey = new Map<string, { card: EnrichedCard; quantity: number }>();
    for (const r of filtered) {
      const key = printingFinishKey(r.card);
      const existing = byKey.get(key);
      if (existing) existing.quantity += r.qty;
      else byKey.set(key, { card: r.card, quantity: r.qty });
    }
    return [...byKey.values()];
  }, [filtered]);

  const handleSaveToList = useCallback(
    async (target: { listId: string } | { newName: string }) => {
      const listId = 'listId' in target ? target.listId : createList(target.newName);
      const { added, skipped } = await addListEntries(listId, saveToListCards);
      setSaveToListOpen(false);
      const name = useCollectionStore.getState().lists.find((l) => l.id === listId)?.name ?? 'list';
      pushToast({
        message:
          added > 0
            ? `Added ${added} ${added === 1 ? 'card' : 'cards'} to “${name}”${
                skipped > 0 ? ` · ${skipped} already there` : ''
              }`
            : `Already in “${name}”, nothing to add`,
        tone: added > 0 ? 'success' : 'info',
      });
    },
    [createList, addListEntries, saveToListCards, pushToast]
  );

  // Clear all active filters and the search term at once.
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setColorFilter(new Set());
    setColorMode('any');
    setSupertypeExpr(EMPTY_EXPR);
    setTypesExpr(EMPTY_EXPR);
    setSubtypeExpr(EMPTY_EXPR);
    setRarityExpr(EMPTY_EXPR);
    setOracleExpr(EMPTY_EXPR);
    setOracleTagExpr(EMPTY_EXPR);
    setScryfallQuery(undefined);
    setLegalityExpr(EMPTY_EXPR);
    setLayoutExpr(EMPTY_EXPR);
    setTreatmentExpr(EMPTY_EXPR);
    setBorderExpr(EMPTY_EXPR);
    setFinishExpr(EMPTY_EXPR);
    setConditionExpr(EMPTY_EXPR);
    setLanguageExpr(EMPTY_EXPR);
    setBinderExpr(EMPTY_EXPR);
    setSetFilter(new Set());
    setGroupPrintings(true);
    setSurplusOnly(false);
    setProxyOnly(false);
    setPriceMin(undefined);
    setPriceMax(undefined);
    setCmcMin(undefined);
    setCmcMax(undefined);
  }, [EMPTY_EXPR]);

  // A jump from an external surface (currently the Breakdown drawer — see
  // `filterJump`'s doc on Props) clears every other active filter first, then
  // sets only the matching one — otherwise a search term or another chip
  // still in effect would narrow the result below the count the row itself
  // showed ("Blue · 854" landing on fewer than 854 cards). Declared after
  // `clearAllFilters` so it can call it directly with no use-before-define
  // hazard. Unlike the `?binder=` deep link above (which only ever reads at
  // mount), this runs on every change: the drawer and this table are mounted
  // siblings for the whole page's lifetime, not separate navigations.
  useEffect(() => {
    if (!filterJump) return;
    clearAllFilters();
    switch (filterJump.kind) {
      case 'binder':
        setBinderExpr({ chips: [{ value: filterJump.name, negate: false }], joiners: [] });
        break;
      case 'color':
        // 'all' (exact match) mirrors the breakdown bucket's semantics — see
        // lib/collection/collection-insights.ts's colorFilterJump doc.
        setColorFilter(new Set([filterJump.key]));
        setColorMode('all');
        break;
      case 'rarity':
        setRarityExpr({ chips: [{ value: filterJump.key, negate: false }], joiners: [] });
        break;
      case 'type':
        setTypesExpr({ chips: [{ value: filterJump.key, negate: false }], joiners: [] });
        break;
      case 'set':
        setSetFilter(new Set([filterJump.code]));
        break;
      case 'surplus':
        setSurplusOnly(true);
        break;
    }
    onFilterJumpApplied?.();
    // Only the jump's identity should retrigger this — clearAllFilters and
    // the setters are stable-enough (clearAllFilters is itself a useCallback
    // keyed on the stable EMPTY_EXPR constant); onFilterJumpApplied is the
    // caller's inline prop and must stay out or a parent re-render would
    // re-fire this and re-clear filters the user has since changed by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterJump, clearAllFilters]);

  // Build the active-filter chip descriptors — one per non-empty filter group.
  // Each chip knows how to clear its own slice so × on a chip is surgical.
  // The chips are derived state; the single place that maps filter state →
  // human labels avoids scattering label strings across the JSX.
  const activeFilterChips = useMemo<FilterChipDescriptor[]>(
    () =>
      buildActiveFilterChips({
        search,
        colorFilter,
        colorMode,
        rarityExpr,
        supertypeExpr,
        typesExpr,
        subtypeExpr,
        oracleExpr,
        oracleTagExpr,
        scryfallQuery,
        legalityExpr,
        layoutExpr,
        treatmentExpr,
        borderExpr,
        finishExpr,
        conditionExpr,
        languageExpr,
        binderExpr,
        setFilter,
        priceMin,
        priceMax,
        cmcMin,
        cmcMax,
        surplusOnly,
        proxyOnly,
        groupPrintings,
        EMPTY_EXPR,
        setSearch,
        setColorFilter,
        setRarityExpr,
        setSupertypeExpr,
        setTypesExpr,
        setSubtypeExpr,
        setOracleExpr,
        setOracleTagExpr,
        setScryfallQuery,
        setLegalityExpr,
        setLayoutExpr,
        setTreatmentExpr,
        setBorderExpr,
        setFinishExpr,
        setConditionExpr,
        setLanguageExpr,
        setBinderExpr,
        setSetFilter,
        setPriceMin,
        setPriceMax,
        setCmcMin,
        setCmcMax,
        setGroupPrintings,
        setSurplusOnly,
        setProxyOnly,
      }),
    [
      search,
      colorFilter,
      colorMode,
      rarityExpr,
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      conditionExpr,
      languageExpr,
      binderExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      surplusOnly,
      proxyOnly,
      groupPrintings,
      EMPTY_EXPR,
    ]
  );

  // Selection copy count (for the "N rows · M copies" selection display).
  const selectedCopiesCount = useMemo(() => {
    if (selectedRowKeys.size === 0) return 0;
    return sorted.filter((r) => selectedRowKeys.has(r.key)).reduce((sum, r) => sum + r.qty, 0);
  }, [sorted, selectedRowKeys]);

  // The selection's actions: the bulk toolbar's buttons and the menu a
  // right-click on a selected card opens, from one list (T162).
  const bulkActions: OverflowMenuItem[] = [
    { label: 'Move to…', onClick: () => setBulkMoveOpen(true) },
    {
      label: bulkProxyAllMarked ? 'Unmark proxy' : 'Mark as proxy',
      onClick: handleBulkToggleProxy,
    },
    { label: 'Delete selected', danger: true, onClick: handleBulkDelete },
  ];
  const bulkCountLabel = `${selectedRowKeys.size} ${selectedRowKeys.size === 1 ? 'row' : 'rows'} · ${selectedCopiesCount} ${selectedCopiesCount === 1 ? 'copy' : 'copies'}`;

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
              supertypeExpr={supertypeExpr}
              setSupertypeExpr={setSupertypeExpr}
              typesExpr={typesExpr}
              setTypesExpr={setTypesExpr}
              subtypeExpr={subtypeExpr}
              setSubtypeExpr={setSubtypeExpr}
              subtypeSuggestions={subtypeSuggestions}
              colorFilter={colorFilter}
              setColorFilter={setColorFilter}
              colorMode={colorMode}
              setColorMode={setColorMode}
              colorOptions={COLOR_FILTERS}
              rarityExpr={rarityExpr}
              setRarityExpr={setRarityExpr}
              rarities={RARITIES}
              oracleExpr={oracleExpr}
              setOracleExpr={setOracleExpr}
              oracleTagExpr={oracleTagExpr}
              setOracleTagExpr={setOracleTagExpr}
              scryfallQuery={scryfallQuery}
              setScryfallQuery={setScryfallQuery}
              legalityExpr={legalityExpr}
              setLegalityExpr={setLegalityExpr}
              layoutExpr={layoutExpr}
              setLayoutExpr={setLayoutExpr}
              treatmentExpr={treatmentExpr}
              setTreatmentExpr={setTreatmentExpr}
              borderExpr={borderExpr}
              setBorderExpr={setBorderExpr}
              finishExpr={finishExpr}
              setFinishExpr={setFinishExpr}
              conditionExpr={conditionExpr}
              setConditionExpr={setConditionExpr}
              languageExpr={languageExpr}
              setLanguageExpr={setLanguageExpr}
              languages={languageOptions}
              binderExpr={binderExpr}
              setBinderExpr={setBinderExpr}
              binders={binders}
              hideBinderFilter={hideBinderFilter}
              setFilter={setFilter}
              setSetFilter={setSetFilter}
              setMap={setMap}
              priceMin={priceMin}
              setPriceMin={setPriceMin}
              priceMax={priceMax}
              setPriceMax={setPriceMax}
              cmcMin={cmcMin}
              setCmcMin={setCmcMin}
              cmcMax={cmcMax}
              setCmcMax={setCmcMax}
              groupPrintings={groupPrintings}
              setGroupPrintings={setGroupPrintings}
              surplusOnly={surplusOnly}
              setSurplusOnly={setSurplusOnly}
              proxyOnly={proxyOnly}
              setProxyOnly={setProxyOnly}
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
        <FilterChipsRow chips={activeFilterChips} onClearAll={clearAllFilters}>
          {structuredFilterActive && (
            <button
              type="button"
              className="collection-save-as-binder-btn"
              onClick={handleSaveAsBinderClick}
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
          hint={'Search above to add a card, or use Add cards.'}
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
          actions={<Button onClick={clearAllFilters}>Clear filters</Button>}
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
                  allocations={allocationsFor(r.card)}
                  cubeListings={cubeListingsFor(r.card.name)}
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
                    allocations={allocationsFor(r.card)}
                    cubeListings={cubeListingsFor(r.card.name)}
                    binders={r.binders}
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
          onCancel={() => setEditingCard(null)}
        />
      )}

      {deletingRow && (
        <RemoveCopiesDialog
          cardName={deletingRow.card.name}
          total={deletingRow.total}
          onConfirm={confirmDeleteCount}
          onCancel={() => setDeletingRow(null)}
        />
      )}

      {bulkMoveOpen && (
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
            setBulkMoveOpen(false);
            clearSelection();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
