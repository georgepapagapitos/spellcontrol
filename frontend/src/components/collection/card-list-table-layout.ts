import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SortField } from '@/types/index';
import type { SetMap } from '@/lib/api';
import { getSectionMeta } from '@spellcontrol/binder-routing';
import { useScrollContainer } from '@/lib/util/scroll-container';
import { GRID_GAP_PX, zoomCols, zoomTier } from '@/lib/util/grid-zoom';
import { GRID_CAPTION_H, GRID_CAPTION_PLATE_PAD, remScale } from '@/components/shared/CardGridCell';
import {
  groupRowsIntoSections,
  buildGridLayout,
  buildListLayout,
  type SectionHeader,
  type GridLayoutRow,
  type ListLayoutRow,
} from '@/lib/collection/group-sections';
import {
  GRID_SECTION_HEADER_H,
  GROUP_KEY_TO_FIELD,
  listRowEstimate,
  loadCollapsedKeys,
  persistCollapsedKeys,
  type GroupKey,
  type Row,
  type ViewMode,
} from './card-list-table-config';

// The collection table's grouping and virtual-scroll layout, lifted out of
// CardListTable (E549). `useGroupedRows` buckets the sorted rows under section
// headers and owns the persisted fold state; `useTableLayout` owns the
// scroll-container measurements, both virtualizers and the sticky
// active-section overlay.

export function useGroupedRows(sorted: Row[], groupKey: GroupKey, setMap: SetMap | undefined) {
  // Collapsed section keys for the active group field, persisted per field so the
  // fold state survives reloads. Reloaded whenever the grouping changes.
  // Re-read on a grouping change during render (the React-documented way to
  // reset state from a prop) so no frame shows the old field's fold state.
  const [fold, setFold] = useState(() => ({ groupKey, keys: loadCollapsedKeys(groupKey) }));
  if (fold.groupKey !== groupKey) setFold({ groupKey, keys: loadCollapsedKeys(groupKey) });
  const collapsedKeys = fold.keys;
  const toggleCollapsed = useCallback(
    (key: string) => {
      setFold((prev) => {
        const next = new Set(prev.keys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistCollapsedKeys(groupKey, next);
        return { groupKey, keys: next };
      });
    },
    [groupKey]
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
    setFold({ groupKey, keys: next });
    persistCollapsedKeys(groupKey, next);
  }, [allCollapsed, allSectionKeys, groupKey]);

  return {
    displayRows,
    sectionHeaders,
    collapsedKeys,
    toggleCollapsed,
    allSectionKeys,
    allCollapsed,
    toggleAllCollapsed,
  };
}

interface LayoutArgs {
  view: ViewMode;
  phone: boolean;
  groupKey: GroupKey;
  displayRowCount: number;
  /** The trailing Add-cards hand-off rides as one extra grid row. */
  showScryfall: boolean;
  sortedCount: number;
  sectionHeaders: Map<number, SectionHeader> | null;
  collapsedKeys: Set<string>;
  effectiveZoom: number;
  gridCaptionLines: number;
  /** Changes when filters, sort, grouping or view change; the list scrolls to top. */
  resetKey: string;
}

export function useTableLayout({
  view,
  phone,
  groupKey,
  displayRowCount,
  showScryfall,
  sortedCount,
  sectionHeaders,
  collapsedKeys,
  effectiveZoom,
  gridCaptionLines,
  resetKey,
}: LayoutArgs) {
  const listContainerRef = useRef<HTMLDivElement>(null);
  // A callback ref held in state, not a ref object: the grid mounts late
  // whenever the table first rendered an empty state (a filter that matched
  // nothing, then a query that brought in the Add-cards hand-off), and the
  // width observer below must attach to it then, not only when `view` changes.
  const [gridEl, gridContainerRef] = useState<HTMLDivElement | null>(null);
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

  // Scroll to top when filters, sort, or view mode change.
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
    const el = gridEl;
    if (!el || view !== 'grid') return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, gridEl]);
  const gridCols = gridWidth > 0 ? zoomCols(effectiveZoom, zoomTier(gridWidth), gridWidth) : 4;

  // Heterogeneous grid row list: full-width section headers interleaved with
  // chunked card rows. The "Add cards" hand-off rides as one trailing item.
  const gridLayout = useMemo<GridLayoutRow[]>(
    () =>
      view === 'grid'
        ? buildGridLayout(
            displayRowCount,
            gridCols,
            sectionHeaders,
            showScryfall ? 1 : 0,
            collapsedKeys
          )
        : [],
    [view, displayRowCount, gridCols, sectionHeaders, showScryfall, collapsedKeys]
  );

  // List/compact mirror of `gridLayout`: header rows interleaved with one row
  // per card, collapsed sections folding to their header. Headers ride as their
  // own virtual rows (not inside the first card) so a folded section keeps a
  // tappable header with zero card rows below it.
  const listLayout = useMemo<ListLayoutRow[]>(
    () => (view === 'grid' ? [] : buildListLayout(displayRowCount, sectionHeaders, collapsedKeys)),
    [view, displayRowCount, sectionHeaders, collapsedKeys]
  );

  // Per-index height estimate: section headers are a fixed short row, card rows
  // derive from the live column width (exact aspect ratio), so the grid stays
  // measureElement-free — the estimate is the truth and offsets never drift.
  const rem = useMemo(remScale, []);
  const estimateGridRowHeight = useCallback(
    (index: number) => {
      if (gridLayout[index]?.kind === 'header') return GRID_SECTION_HEADER_H;
      if (!gridWidth) return 250;
      const colWidth = (gridWidth - GRID_GAP_PX * (gridCols - 1)) / gridCols;
      return (
        colWidth * (680 / 488) +
        (GRID_CAPTION_H * gridCaptionLines + (gridCaptionLines > 0 ? GRID_CAPTION_PLATE_PAD : 0)) *
          rem +
        GRID_GAP_PX
      );
    },
    [gridWidth, gridCols, gridLayout, gridCaptionLines, rem]
  );

  useLayoutEffect(() => {
    if (!scrollEl) return;
    const measure = () => {
      const el = view === 'grid' ? gridEl : listContainerRef.current;
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
  }, [scrollEl, view, gridEl, gridCols, sortedCount, chromeBottom]);

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

  // The grid is measureElement-free (the estimate is the truth), and the
  // virtualizer only re-reads estimates when its count or margin changes, so
  // cached row heights must be dropped whenever the estimate itself moves: a
  // caption toggle (they'd drift by GRID_CAPTION_H per row) or a new width.
  // The width case is the late-mounting grid: its rows were seeded at the
  // 250px no-width fallback and a full-height tile overran the footer.
  useEffect(() => {
    gridVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridWidth, gridCols, gridCaptionLines]);

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

  return {
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
  };
}
