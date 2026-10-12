import { useEffect, useMemo, useState } from 'react';
import { clampZoom, readStoredZoom } from '@/lib/util/grid-zoom';
import {
  readStoredExportFormat,
  writeStoredExportFormat,
  type ExportFormat,
} from '@/lib/import-export/deck-export';
import {
  readStoredViewMode,
  readStoredCollapsedSections,
  writeStoredCollapsedSections,
  readStoredShowPrefs,
  readStoredGroupBy,
  SORT_DEFAULT_DIR,
  VIEW_MODE_STORAGE_KEY,
  SHOW_PREFS_STORAGE_KEY,
  GROUP_BY_STORAGE_KEY,
  type SortMode,
  type DeckViewMode,
  type ShowPrefs,
  type DeckGroupBy,
} from './deck-display-rows';
import { titlesUnder } from './deck-display-derive';

const GRID_SIZE_STORAGE_KEY = 'mtg-decks-grid-size';

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * The deck view's own preferences: sort + search, view mode, grouping lens,
 * grid zoom, show toggles, collapsed sections and the export format. The ones
 * a reader expects to stick are persisted to localStorage.
 */
export function useDeckViewPrefs() {
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

  const handleExportFormatChange = (f: ExportFormat) => {
    setExportFormat(f);
    writeStoredExportFormat(f);
  };
  const handleViewModeChange = (m: DeckViewMode) => {
    setViewMode(m);
    store(VIEW_MODE_STORAGE_KEY, m);
  };
  const handleGroupByChange = (g: DeckGroupBy) => {
    setGroupBy(g);
    store(GROUP_BY_STORAGE_KEY, g);
  };
  const handleGridZoomChange = (z: number) => {
    setGridZoom(z);
    store(GRID_SIZE_STORAGE_KEY, String(z));
  };
  const handleShowPrefsChange = (next: ShowPrefs) => {
    setShowPrefs(next);
    store(SHOW_PREFS_STORAGE_KEY, JSON.stringify(next));
  };

  return {
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
  };
}
