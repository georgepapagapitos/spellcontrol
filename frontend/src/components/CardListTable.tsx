import {
  AlignJustify,
  Check,
  CheckSquare,
  LayoutGrid,
  List as ListIconLucide,
  Plus,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollContainer } from '../lib/scroll-container';
import type {
  ChipExpression,
  EnrichedCard,
  MaterializedBinder,
  SortField,
  SortDir,
} from '../types';
import type { SetMap } from '../lib/api';
import { CardRowMenu } from './CardRowMenu';
import { CardPreview } from './CardPreview';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { RemoveCopiesDialog } from './RemoveCopiesDialog';
import { BulkMoveToBinderSheet } from './BulkMoveToBinderSheet';
import { useConfirm } from '../lib/use-confirm';
import { removeCopiesOfPrinting, printingFinishKey } from '../lib/collection-mutations';
import { useToastsStore } from '../store/toasts';
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { ManaCost } from './ManaCost';
import { DeckBadge } from './DeckBadge';
import { BinderBadge, type BinderInfo } from './BinderBadge';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { ViewModeToggle } from './ViewModeToggle';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';
import { InlineCardSearch } from './InlineCardSearch';
import { SortDirArrow } from './SortDirArrow';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { classifyFoil } from '../lib/foil-style';
import { sortCards, printingKey, type SortContext } from '../lib/sorting';
import { getColorKey, COLOR_INFO } from '../lib/colors';
import { useCollectionStore } from '../store/collection';
import { fetchTypeSuggestions } from '../lib/scryfall-catalog';
import { parseTypeLine, SUPERTYPES, TYPES } from '../lib/card-types';
import {
  compileExpression,
  effectiveTreatments,
  exactMatchesExpression,
  isExpressionEmpty,
  legalityMatchesExpression,
  setMatchesExpression,
  substringMatchesExpression,
} from '../lib/rules';

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
   * Opens the Add cards sheet. Wired by the Collection page so the
   * empty-collection state can offer an inline "Add cards" CTA without this
   * component needing to know how the sheet is mounted. Omitted in scoped
   * views (e.g. a single binder) that never render the empty-collection state.
   */
  onAddCards?: () => void;
}

interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  // Primary binder for this row — first copy seen. Drives section grouping
  // and the move-to-binder menu's "currently in" anchor.
  binderId: string | null;
  binderName: string | null;
  binderColor: string | null;
  // All binders covering any of this row's copies, deduped by id. When
  // grouping is off this is at most one entry; when grouping is on the
  // badge surfaces every binder the stacked copies are in.
  binders: BinderInfo[];
}

type ViewMode = 'grid' | 'list' | 'compact';
type GridSize = '1x' | '2x' | '3x';

const COLLECTION_VIEW_KEY = 'mtg-collection-view-mode';
const GRID_SIZE_KEY = 'mtg-collection-grid-size';

const GRID_SIZE_MIN_COL: Record<GridSize, { desktop: number; mobile: number }> = {
  '1x': { desktop: 150, mobile: 110 },
  '2x': { desktop: 220, mobile: 165 },
  '3x': { desktop: 320, mobile: 240 },
};

function readStoredCollectionView(): ViewMode {
  try {
    const v = localStorage.getItem(COLLECTION_VIEW_KEY);
    if (v === 'grid' || v === 'list' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  return 'list';
}

function readStoredGridSize(): GridSize {
  try {
    const v = localStorage.getItem(GRID_SIZE_KEY);
    if (v === '1x' || v === '2x' || v === '3x') return v;
  } catch {
    /* ignore */
  }
  return '1x';
}
type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'cmc' | 'release';

const ROW_HEIGHT_LIST = 66;
const ROW_HEIGHT_COMPACT = 32;

const COLOR_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

const SORT_FIELDS: Array<{ key: SortKey; label: string; defaultDir: 'asc' | 'desc' }> = [
  { key: 'name', label: 'Name', defaultDir: 'asc' },
  { key: 'cmc', label: 'CMC', defaultDir: 'asc' },
  { key: 'price', label: 'Price', defaultDir: 'desc' },
  { key: 'qty', label: 'Quantity', defaultDir: 'desc' },
  { key: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { key: 'set', label: 'Set', defaultDir: 'asc' },
  { key: 'release', label: 'Release date', defaultDir: 'desc' },
];

const SORT_KEY_TO_FIELD: Record<SortKey, SortField> = {
  name: 'name',
  set: 'setName',
  rarity: 'rarity',
  price: 'price',
  qty: 'quantity',
  cmc: 'cmc',
  release: 'setReleaseDate',
};

const SORT_FIELD_BY_KEY: Record<SortKey, (typeof SORT_FIELDS)[number]> = SORT_FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<SortKey, (typeof SORT_FIELDS)[number]>
);

function pickPrice(card: import('@/deck-builder/types').ScryfallCard, foil: boolean): number {
  const p = card.prices;
  if (!p) return 0;
  const candidates = foil ? [p.usd_foil, p.usd_etched, p.usd] : [p.usd, p.usd_etched, p.usd_foil];
  for (const raw of candidates) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function CardListTable({
  cards,
  binders,
  setMap,
  hideBinderFilter = false,
  onAddCards,
}: Props) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [scryfallOpen, setScryfallOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
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
  const [gridSize, setGridSizeRaw] = useState<GridSize>(readStoredGridSize);
  const setGridSize = (s: GridSize) => {
    setGridSizeRaw(s);
    try {
      localStorage.setItem(GRID_SIZE_KEY, s);
    } catch {
      /* ignore */
    }
  };
  // On narrow viewports the document is too narrow for 3× to render
  // visibly larger than 2×, so the option is hidden and any persisted
  // 3× selection is clamped to 2× for layout purposes (without
  // overwriting the stored preference, so it returns when the user
  // resizes back up).
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsNarrow(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  const effectiveGridSize: GridSize = isNarrow && gridSize === '3x' ? '2x' : gridSize;
  const [binderExpr, setBinderExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  // Default ON: a collection reads as "what printings do I own and how
  // many?" — the rolled-up qty pill matches that mental model. Power
  // users who want to see every physical copy individually can toggle.
  const [groupPrintings, setGroupPrintings] = useState(true);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
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
  const [subtypeSuggestions, setSubtypeSuggestions] = useState<string[]>([]);

  useEffect(() => {
    // Fetch the full Scryfall type catalog for subtype autocomplete.
    // Supertypes and primary Types are closed enums (rendered as
    // dropdowns), so only the subtype row needs suggestions. We strip
    // known supertypes/types from the catalog and merge in tokens from
    // the user's actual collection so unusual entries (custom or fan
    // sets) still surface.
    const supertypeSet = new Set<string>(SUPERTYPES);
    const typeSet = new Set<string>(TYPES);
    const collectionSubtypeTokens = new Set<string>();
    for (const c of cards) {
      const { subtypes } = parseTypeLine(c.typeLine);
      for (const s of subtypes) collectionSubtypeTokens.add(s);
    }
    fetchTypeSuggestions().then((catalog) => {
      // Dedupe by lowercase key but prefer the version that has any
      // capitals — the Scryfall catalog supplies canonical casing
      // ("Angel") while parseTypeLine lowercases collection tokens
      // ("angel"). Without this the autocomplete shows both spellings.
      const byLower = new Map<string, string>();
      for (const t of [...catalog, ...collectionSubtypeTokens]) {
        const key = t.toLowerCase();
        if (supertypeSet.has(key) || typeSet.has(key)) continue;
        const existing = byLower.get(key);
        if (!existing || (existing === key && t !== key)) {
          byLower.set(key, t);
        }
      }
      const merged = [...byLower.values()].sort((a, b) => a.localeCompare(b));
      setSubtypeSuggestions(merged);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [borderExpr, setBorderExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [finishExpr, setFinishExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [conditionExpr, setConditionExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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

  // The window no longer scrolls — .app-main is the scroll container. The
  // virtualized list lives below the hero/search/toolbar inside it, so the
  // virtualizer needs that leading offset (scrollMargin) to map scroll
  // position to row index. Measured from rects so it's agnostic to which
  // wrappers are positioned and to toolbar reflow.
  const scrollEl = useScrollContainer();
  const [scrollMargin, setScrollMargin] = useState(0);

  // Global hotkeys while the table is mounted. We ignore key events when the
  // user is typing into an input/textarea/contenteditable so the shortcuts
  // don't fight with normal text entry.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // `/` focuses search even from inside another input would be too
      // surprising; require focus to be outside a typing target.
      const typing = isTypingTarget(e.target);
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && shortcutsOpen) {
        // Modal handles its own Escape, but keep state in sync if it slips.
        return;
      }
      if (typing) return;
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
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcutsOpen]);

  const cardToBinder = useMemo(() => {
    // Per-copy assignment — pinned and rule-matched cards are routed by
    // copyId in materializeBinders, so we mirror that here. Falls back to
    // printing+finish for old materialized cards without a copyId.
    const map = new Map<string, { id: string; name: string; color: string }>();
    for (const b of binders) {
      for (const section of b.sections) {
        for (const c of section.cards) {
          const assignment = { id: b.def.id, name: b.def.name, color: b.def.color };
          if (c.copyId && !map.has(c.copyId)) map.set(c.copyId, assignment);
        }
      }
    }
    return map;
  }, [binders]);

  const rows = useMemo<Row[]>(() => {
    if (!groupPrintings) {
      // One row per physical copy.
      return cards.map((card) => {
        const assignment = cardToBinder.get(card.copyId) ?? null;
        return {
          // copyId is unique per physical copy — gives every row a
          // stable key even when two share the same printing+foil.
          key: card.copyId,
          card,
          qty: 1,
          binderId: assignment?.id ?? null,
          binderName: assignment?.name ?? null,
          binderColor: assignment?.color ?? null,
          binders: assignment ? [assignment] : [],
        };
      });
    }
    // Default: roll duplicate copies of the same printing into one row.
    // Primary binder fields reflect the first assigned copy seen; the
    // `binders` array aggregates every distinct binder across the stack so
    // the badge can show all of them.
    const grouped = new Map<string, Row & { binderIds: Set<string> }>();
    for (const card of cards) {
      const key = `${card.scryfallId}:${card.finish ?? (card.foil ? 'foil' : 'nonfoil')}`;
      const assignment = cardToBinder.get(card.copyId) ?? null;
      const existing = grouped.get(key);
      if (existing) {
        existing.qty += 1;
        if (assignment && !existing.binderIds.has(assignment.id)) {
          existing.binderIds.add(assignment.id);
          existing.binders.push(assignment);
          if (!existing.binderId) {
            existing.binderId = assignment.id;
            existing.binderName = assignment.name;
            existing.binderColor = assignment.color;
          }
        }
      } else {
        const binderIds = new Set<string>();
        if (assignment) binderIds.add(assignment.id);
        grouped.set(key, {
          key,
          card,
          qty: 1,
          binderId: assignment?.id ?? null,
          binderName: assignment?.name ?? null,
          binderColor: assignment?.color ?? null,
          binders: assignment ? [assignment] : [],
          binderIds,
        });
      }
    }
    return [...grouped.values()].map(({ binderIds: _ids, ...row }) => row);
  }, [cards, cardToBinder, groupPrintings]);

  // Compile the type-line expressions once per change; the per-row loop
  // below just checks the compiled groups against the parsed typeline.
  const compiledSupertype = useMemo(() => compileExpression(supertypeExpr), [supertypeExpr]);
  const compiledTypes = useMemo(() => compileExpression(typesExpr), [typesExpr]);
  const compiledSubtype = useMemo(() => compileExpression(subtypeExpr), [subtypeExpr]);
  const compiledRarity = useMemo(() => compileExpression(rarityExpr), [rarityExpr]);
  const compiledBinder = useMemo(() => compileExpression(binderExpr), [binderExpr]);
  const compiledOracle = useMemo(() => compileExpression(oracleExpr), [oracleExpr]);
  const compiledLegality = useMemo(() => compileExpression(legalityExpr), [legalityExpr]);
  const compiledLayout = useMemo(() => compileExpression(layoutExpr), [layoutExpr]);
  const compiledTreatment = useMemo(() => compileExpression(treatmentExpr), [treatmentExpr]);
  const compiledBorder = useMemo(() => compileExpression(borderExpr), [borderExpr]);
  const compiledFinish = useMemo(() => compileExpression(finishExpr), [finishExpr]);
  const compiledCondition = useMemo(() => compileExpression(conditionExpr), [conditionExpr]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.card.name.toLowerCase().includes(q)) return false;
      if (compiledBinder) {
        const bname = r.binderName ?? '__uncategorized';
        if (!exactMatchesExpression(bname, compiledBinder)) return false;
      }
      if (colorFilter.size > 0) {
        const k = getColorKey(r.card);
        // multicolor cards match if any of the selected colors are in identity;
        // colorless matches only if 'C' is selected.
        const ci = r.card.colorIdentity || [];
        const matches =
          (k === 'C' && colorFilter.has('C')) ||
          ci.some((c) => colorFilter.has(c)) ||
          (k !== 'C' && colorFilter.has(k));
        if (!matches) return false;
      }
      if (compiledSupertype || compiledTypes || compiledSubtype) {
        const parsed = parseTypeLine(r.card.typeLine);
        if (compiledSupertype) {
          if (!setMatchesExpression(parsed.supertypes, compiledSupertype)) return false;
        }
        if (compiledTypes) {
          if (!setMatchesExpression(parsed.types, compiledTypes)) return false;
        }
        if (compiledSubtype) {
          // Substring against the joined subtype text — lets multi-word
          // chips like "Equipment" still match within a longer subtype
          // list like "Artifact — Equipment Vehicle".
          const joined = parsed.subtypes.join(' ');
          if (!substringMatchesExpression(joined, compiledSubtype)) return false;
        }
      }
      if (compiledRarity) {
        if (!exactMatchesExpression(r.card.rarity, compiledRarity)) return false;
      }
      if (compiledOracle && !substringMatchesExpression(r.card.oracleText, compiledOracle))
        return false;
      if (compiledLegality && !legalityMatchesExpression(r.card.legalities, compiledLegality))
        return false;
      if (compiledLayout && !exactMatchesExpression(r.card.layout, compiledLayout)) return false;
      if (
        compiledTreatment &&
        !setMatchesExpression(effectiveTreatments(r.card), compiledTreatment)
      )
        return false;
      if (compiledBorder && !exactMatchesExpression(r.card.borderColor, compiledBorder))
        return false;
      if (compiledFinish) {
        // Match the finish the user *owns*, not the printing's available
        // finishes — mirrors cardMatchesCompiled so "Finish IS foil" doesn't
        // match every nonfoil basic that merely comes in foil too.
        const owned = r.card.finish ?? (r.card.foil ? 'foil' : 'nonfoil');
        if (!setMatchesExpression([owned], compiledFinish)) return false;
      }
      if (compiledCondition && !exactMatchesExpression(r.card.condition, compiledCondition))
        return false;
      if (setFilter.size > 0 && !setFilter.has((r.card.setCode || '').toUpperCase())) return false;
      return true;
    });
  }, [
    rows,
    debouncedSearch,
    compiledBinder,
    colorFilter,
    compiledSupertype,
    compiledTypes,
    compiledSubtype,
    compiledRarity,
    compiledOracle,
    compiledLegality,
    compiledLayout,
    compiledTreatment,
    compiledBorder,
    compiledFinish,
    compiledCondition,
    setFilter,
  ]);

  const sorted = useMemo(() => {
    const field: SortField = SORT_KEY_TO_FIELD[sortKey];
    const dir: SortDir = sortDir;
    // Map row.qty into a printing-keyed table so the shared comparator's
    // "quantity" sort uses the displayed (rolled-up or per-copy) qty.
    const qtyByPrintingKey = new Map<string, number>();
    for (const r of filtered) qtyByPrintingKey.set(printingKey(r.card), r.qty);
    const ctx: SortContext = { setMap, qtyByPrintingKey };
    const sortedCards = sortCards(
      filtered.map((r) => r.card),
      [{ field, dir }],
      ctx
    );
    const byCopyId = new Map(filtered.map((r) => [r.card.copyId, r]));
    return sortedCards.map((c) => byCopyId.get(c.copyId)!).filter(Boolean) as Row[];
  }, [filtered, sortKey, sortDir, setMap]);

  // Stable parallel arrays for the card preview carousel. Built inline in JSX,
  // these would get a fresh identity on every render — and since each swipe
  // re-renders this component (via onIndexChange → setPreviewIndex), that
  // churned CardPreview's IntersectionObserver (deps: [cards]) on every swipe,
  // re-observing every slide. Memoizing on `sorted` keeps the reference stable,
  // matching how BinderView feeds its memoized flat arrays.
  const previewCards = useMemo(() => sorted.map((r) => r.card), [sorted]);
  const previewSectionLabels = useMemo(
    () => sorted.map((r) => (r.binders.length === 0 ? 'Uncategorized' : '')),
    [sorted]
  );
  const previewPageNumbers = useMemo(() => sorted.map(() => 0), [sorted]);

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
  const resetKey = `${debouncedSearch}|${sortKey}|${sortDir}|${view}`;
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      scrollEl?.scrollTo({ top: 0 });
    }
  }, [resetKey, scrollEl]);

  // Grid: compute column count from container width for row-of-columns virtualization.
  const [gridCols, setGridCols] = useState(4);
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el || view !== 'grid') return;
    const measure = () => {
      const w = el.clientWidth;
      const sizeConfig = GRID_SIZE_MIN_COL[effectiveGridSize];
      const minCol = w <= 1024 ? sizeConfig.mobile : sizeConfig.desktop;
      const gap = w <= 1024 ? 8 : 10;
      setGridCols(Math.max(1, Math.floor((w + gap) / (minCol + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, effectiveGridSize]);

  // Offer Scryfall add whenever there's a real query — even with zero
  // collection matches (then the trigger is the only card/row).
  const showScryfall = debouncedSearch.trim().length >= 2;
  // The trigger box only exists to *open* the live results panel — once that
  // panel is open it's redundant, so hide it and let the results take its
  // place (the grid/list reflows as if the trigger were never there).
  const showScryfallTrigger = showScryfall && !scryfallOpen;
  const triggerIndex = sorted.length;
  const gridItemCount = sorted.length + (showScryfallTrigger ? 1 : 0);
  const gridRowCount = view === 'grid' ? Math.ceil(gridItemCount / gridCols) : 0;
  const GRID_GAP = 10;

  // When the query is cleared (or drops below the 2-char threshold), leave
  // search mode so the next real query starts from the trigger box again
  // rather than silently reopening the results panel.
  useEffect(() => {
    if (!showScryfall) setScryfallOpen(false);
  }, [showScryfall]);

  const estimateGridRowHeight = useCallback(() => {
    if (!gridContainerRef.current) return 250;
    const w = gridContainerRef.current.clientWidth;
    const colWidth = (w - GRID_GAP * (gridCols - 1)) / gridCols;
    return colWidth * (680 / 488) + GRID_GAP;
  }, [gridCols]);

  useLayoutEffect(() => {
    if (!scrollEl) return;
    const measure = () => {
      const el = view === 'grid' ? gridContainerRef.current : listContainerRef.current;
      if (!el) return;
      const top =
        el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - top) > 0.5 ? top : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollEl, view, gridCols, sorted.length]);

  const listVirtualizer = useVirtualizer({
    count: view !== 'grid' ? sorted.length : 0,
    getScrollElement: () => scrollEl,
    estimateSize: () => (view === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_LIST),
    overscan: 20,
    scrollMargin,
  });

  const gridVirtualizer = useVirtualizer({
    count: gridRowCount,
    getScrollElement: () => scrollEl,
    estimateSize: estimateGridRowHeight,
    overscan: 8,
    scrollMargin,
  });

  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return cards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, cards]);
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const allCards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  // Index allocations by printing (scryfallId + foil) once so per-row lookups
  // stay O(1). Without this, allocationsFor scans allCards on every call —
  // and we call it once per row when feeding the preview carousel.
  const allocationsByPrinting = useMemo(() => {
    if (!groupPrintings) return null;
    const map = new Map<string, AllocationInfo[]>();
    for (const c of allCards) {
      const a = allocations.get(c.copyId);
      if (!a) continue;
      const key = `${c.scryfallId}:${c.foil ? 'foil' : 'nonfoil'}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [groupPrintings, allCards, allocations]);
  const allocationsFor = useCallback(
    (c: EnrichedCard): AllocationInfo[] => {
      if (!groupPrintings) {
        const a = allocations.get(c.copyId);
        return a ? [a] : [];
      }
      const key = `${c.scryfallId}:${c.foil ? 'foil' : 'nonfoil'}`;
      return allocationsByPrinting?.get(key) ?? [];
    },
    [groupPrintings, allocations, allocationsByPrinting]
  );

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    const sc = selection.card;
    const firstFace = sc.card_faces?.[0];
    const cardFields: Partial<EnrichedCard> = {
      scryfallId: sc.id,
      name: sc.name,
      setCode: sc.set.toUpperCase(),
      setName: sc.set_name,
      collectorNumber: sc.collector_number,
      rarity: sc.rarity,
      finish: selection.finish,
      foil: selection.finish !== 'nonfoil',
      imageSmall: sc.image_uris?.small ?? firstFace?.image_uris?.small,
      imageNormal: sc.image_uris?.normal ?? firstFace?.image_uris?.normal,
      imageLarge: sc.image_uris?.large ?? firstFace?.image_uris?.large,
      imageNormalBack: sc.card_faces?.[1]?.image_uris?.normal,
      imageLargeBack: sc.card_faces?.[1]?.image_uris?.large,
      frameEffects: sc.frame_effects,
      fullArt: sc.full_art === true || sc.frame_effects?.includes('fullart'),
      borderColor: sc.border_color,
      layout: sc.layout,
      finishes: sc.finishes,
      promoTypes: sc.promo_types,
      purchasePrice: pickPrice(sc, selection.finish !== 'nonfoil'),
      pricedAt: Date.now(),
    };

    // Existing copies of this printing/finish — these get updated in place,
    // preserving their copyId so any deck allocations stay intact.
    const existingCopies = allCards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish
    );
    const targetQty = selection.quantity ?? existingCopies.length;
    const otherCards = allCards.filter(
      (c) => !(c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish)
    );

    const updatedExisting = existingCopies
      .slice(0, targetQty)
      .map((c) => ({ ...c, ...cardFields, copyId: c.copyId }));
    const newCopies: EnrichedCard[] = [];
    for (let i = updatedExisting.length; i < targetQty; i++) {
      newCopies.push({
        ...editingCard,
        ...cardFields,
        copyId: crypto.randomUUID(),
        sourceCategory: editingCard.sourceCategory,
        sourceFormat: editingCard.sourceFormat,
        importId: editingCard.importId,
      } as EnrichedCard);
    }

    replaceAllCards([...otherCards, ...updatedExisting, ...newCopies]);
    setEditingCard(null);
  };

  const pushToast = useToastsStore((s) => s.push);
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
      pushToast({
        message: `Removed ${removed.length} ${removed.length === 1 ? 'copy' : 'copies'} of ${removed[0].name}`,
        tone: 'info',
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
          ? `${skipped} copy(ies) reserved by a deck will be kept. This can be undone.`
          : `The selected copies will be removed from your collection. This can be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok || removable.length === 0) return;
    applyRemoval(removable);
    clearSelection();
  }, [selectedCopyIds, allCards, allocatedCopyIds, confirm, applyRemoval, clearSelection]);

  // Count active filter *groups*, not individual chips — five colors
  // selected is still one filter group, so the badge stays glanceable.
  const activeFilterCount =
    (!isExpressionEmpty(supertypeExpr) ? 1 : 0) +
    (!isExpressionEmpty(typesExpr) ? 1 : 0) +
    (!isExpressionEmpty(subtypeExpr) ? 1 : 0) +
    (colorFilter.size > 0 ? 1 : 0) +
    (!isExpressionEmpty(rarityExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleExpr) ? 1 : 0) +
    (!isExpressionEmpty(legalityExpr) ? 1 : 0) +
    (!isExpressionEmpty(layoutExpr) ? 1 : 0) +
    (!isExpressionEmpty(treatmentExpr) ? 1 : 0) +
    (!isExpressionEmpty(borderExpr) ? 1 : 0) +
    (!isExpressionEmpty(finishExpr) ? 1 : 0) +
    (!isExpressionEmpty(conditionExpr) ? 1 : 0) +
    (!isExpressionEmpty(binderExpr) ? 1 : 0) +
    (setFilter.size > 0 ? 1 : 0) +
    (groupPrintings ? 0 : 1);

  return (
    <div className="card-list">
      {/* Sticky search row — pinned to the top of the list scroll.
          Search + filter icon only; totals and Stats sit in the
          secondary row below so this bar stays compact across every
          breakpoint. */}
      <div className="collection-toolbar-row">
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
              colorOptions={COLOR_FILTERS}
              rarityExpr={rarityExpr}
              setRarityExpr={setRarityExpr}
              rarities={RARITIES}
              oracleExpr={oracleExpr}
              setOracleExpr={setOracleExpr}
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
              binderExpr={binderExpr}
              setBinderExpr={setBinderExpr}
              binders={binders}
              hideBinderFilter={hideBinderFilter}
              setFilter={setFilter}
              setSetFilter={setSetFilter}
              setMap={setMap}
              groupPrintings={groupPrintings}
              setGroupPrintings={setGroupPrintings}
              activeCount={activeFilterCount}
            />
          }
        />
      </div>

      <div className="card-list-summary-line">
        <div className="card-list-summary-actions">
          {sorted.length > 0 && (
            <button
              type="button"
              className="toolbar-pill card-list-select-toggle"
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              <CheckSquare width={14} height={14} strokeWidth={2} aria-hidden />
              <span>{selectMode ? 'Done' : 'Select'}</span>
            </button>
          )}
          <SelectMenu
            ariaLabel="Sort"
            value={sortKey}
            options={SORT_FIELDS.map((f) => ({ value: f.key, label: f.label }))}
            onChange={toggleSort}
            closeOnSelect={false}
            leadingIcon={<SortDirArrow dir={sortDir} />}
            renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
          />
          {view === 'grid' && (
            <ViewModeToggle<GridSize>
              ariaLabel="Card size"
              value={effectiveGridSize}
              onChange={setGridSize}
              options={
                isNarrow
                  ? [
                      { value: '1x', label: 'Small cards', icon: <span>1×</span> },
                      { value: '2x', label: 'Medium cards', icon: <span>2×</span> },
                    ]
                  : [
                      { value: '1x', label: 'Small cards', icon: <span>1×</span> },
                      { value: '2x', label: 'Medium cards', icon: <span>2×</span> },
                      { value: '3x', label: 'Large cards', icon: <span>3×</span> },
                    ]
              }
            />
          )}
          <ViewModeToggle<ViewMode>
            ariaLabel="Collection view mode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'grid',
                label: 'Grid view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view (with thumbnails)',
                icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'compact',
                label: 'Compact list (text only)',
                icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>
      </div>

      {selectMode && (
        <div className="card-list-bulk-toolbar" role="region" aria-label="Bulk actions">
          <span className="card-list-bulk-count">
            {selectedRowKeys.size > 0 ? `${selectedRowKeys.size} selected` : 'Select cards…'}
          </span>
          <button
            type="button"
            className="toolbar-pill"
            onClick={() => (allSelected ? clearSelection() : selectAll())}
          >
            {allSelected ? 'Deselect all' : `Select all (${sorted.length})`}
          </button>
          <button
            type="button"
            className="toolbar-pill"
            disabled={selectedRowKeys.size === 0}
            onClick={() => setBulkMoveOpen(true)}
          >
            Move to…
          </button>
          <button
            type="button"
            className="toolbar-pill card-list-bulk-danger"
            disabled={selectedRowKeys.size === 0}
            onClick={handleBulkDelete}
          >
            Delete selected
          </button>
          {selectedRowKeys.size > 0 && !allSelected && (
            <button type="button" className="toolbar-pill" onClick={clearSelection}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="toolbar-pill card-list-bulk-done"
            onClick={exitSelectMode}
          >
            Done
          </button>
        </div>
      )}

      {previewIndex !== null && sorted[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Collection"
          sectionLabels={previewSectionLabels}
          pageNumbers={previewPageNumbers}
          totalPages={0}
          getStackBinders={(i) => sorted[i]?.binders ?? []}
          getStackAllocations={(i) => (sorted[i] ? allocationsFor(sorted[i].card) : [])}
          getStackQty={(i) => sorted[i]?.qty ?? 1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onEdit={(c) => {
            setPreviewIndex(null);
            setEditingCard(c);
          }}
        />
      )}

      {cards.length === 0 && !showScryfall ? (
        // Brand-new, never-populated collection — distinct from a filtered
        // "no matches". Same view, just empty: point at the search bar above
        // and offer the Add cards sheet (search · list · scan) right here.
        <div className="empty-state">
          <p className="empty-state-tagline">Your collection is empty</p>
          <p className="empty-state-hint">
            Search for a card above to add it, or use Add cards to import a list or scan your cards.
          </p>
          {onAddCards && (
            <button
              type="button"
              className="btn btn-primary empty-state-action"
              onClick={onAddCards}
            >
              <Plus width={16} height={16} strokeWidth={1.8} aria-hidden />
              <span>Add cards</span>
            </button>
          )}
        </div>
      ) : sorted.length === 0 && !showScryfall ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No matches</p>
          <p className="empty-state-hint">
            No cards match your current filters. Try broadening your search or clearing some
            filters.
          </p>
        </div>
      ) : view === 'grid' ? (
        <div
          ref={gridContainerRef}
          className="collection-grid"
          style={{
            height: gridVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {gridVirtualizer.getVirtualItems().map((virtualRow) => {
            const startIdx = virtualRow.index * gridCols;
            return (
              <div
                key={virtualRow.key}
                className="collection-grid-vrow"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gap: `${GRID_GAP}px`,
                }}
              >
                {Array.from({ length: gridCols }, (_, colIdx) => {
                  const idx = startIdx + colIdx;
                  if (idx === triggerIndex && showScryfallTrigger) {
                    return (
                      <button
                        key="scryfall-trigger"
                        type="button"
                        className="collection-grid-item collection-grid-scryfall"
                        onClick={() => setScryfallOpen(true)}
                        aria-expanded={false}
                        aria-label={`Search Scryfall for ${debouncedSearch.trim()}`}
                      >
                        <Search width={26} height={26} strokeWidth={1.6} aria-hidden />
                        <span className="collection-grid-scryfall-title">Search Scryfall</span>
                        <span className="collection-grid-scryfall-sub">
                          for “{debouncedSearch.trim()}”
                        </span>
                      </button>
                    );
                  }
                  if (idx >= sorted.length) return null;
                  const r = sorted[idx];
                  const foilStyle = classifyFoil(r.card);
                  const foilClass = foilStyle !== 'none' ? ` is-foil foil-${foilStyle}` : '';
                  const selected = selectedRowKeys.has(r.key);
                  return (
                    <div
                      key={r.key}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectMode ? selected : undefined}
                      className={`collection-grid-item grid-${effectiveGridSize}${foilClass}${
                        selectMode ? ' is-selectable' : ''
                      }${selected ? ' is-selected' : ''}`}
                      onClick={() => (selectMode ? toggleRow(r.key) : setPreviewIndex(idx))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (selectMode) toggleRow(r.key);
                          else setPreviewIndex(idx);
                        }
                      }}
                      aria-label={`${r.card.name}, quantity ${r.qty}${r.card.foil ? ', foil' : ''}${
                        selectMode ? (selected ? ', selected' : ', not selected') : ''
                      }`}
                    >
                      {selectMode && (
                        <span className="collection-grid-check" data-checked={selected} aria-hidden>
                          {selected && <Check width={14} height={14} strokeWidth={3} />}
                        </span>
                      )}
                      {r.card.imageNormal ? (
                        <img
                          src={r.card.imageNormal}
                          alt={r.card.name}
                          loading="lazy"
                          className="collection-grid-img"
                        />
                      ) : (
                        <div className="collection-grid-placeholder">{r.card.name}</div>
                      )}
                      {r.card.foil && (
                        <>
                          <div className="card-preview-foil-shine" aria-hidden="true" />
                          <div className="card-preview-foil-glare" aria-hidden="true" />
                        </>
                      )}
                      {r.qty > 1 && (
                        <span className="collection-grid-qty">
                          <span className="collection-grid-qty-x" aria-hidden="true">
                            ×
                          </span>
                          {r.qty}
                        </span>
                      )}
                      <div className="collection-grid-badges">
                        <DeckBadge allocations={allocationsFor(r.card)} />
                        <BinderBadge binders={r.binders} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : sorted.length === 0 ? null : (
        <div
          ref={listContainerRef}
          className={`collection-list${view === 'compact' ? ' is-compact' : ''}`}
          style={{
            height: listVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {listVirtualizer.getVirtualItems().map((virtualRow) => {
            const r = sorted[virtualRow.index];
            const colorKey = getColorKey(r.card);
            const selected = selectedRowKeys.has(r.key);
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={listVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                }}
              >
                <div
                  className={`collection-list-row${
                    virtualRow.index === sorted.length - 1 ? ' is-last-row' : ''
                  }${selectMode ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}`}
                  role="row"
                  tabIndex={0}
                  aria-pressed={selectMode ? selected : undefined}
                  onClick={() =>
                    selectMode ? toggleRow(r.key) : setPreviewIndex(virtualRow.index)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (selectMode) toggleRow(r.key);
                      else setPreviewIndex(virtualRow.index);
                    }
                  }}
                >
                  {selectMode && (
                    <span className="collection-list-check" data-checked={selected} aria-hidden>
                      {selected && <Check width={13} height={13} strokeWidth={3} />}
                    </span>
                  )}
                  {r.card.imageSmall ? (
                    <img
                      src={r.card.imageSmall}
                      alt=""
                      loading="lazy"
                      className="collection-list-thumb"
                    />
                  ) : (
                    <div
                      className="collection-list-thumb collection-list-thumb-placeholder"
                      style={{ background: COLOR_INFO[colorKey]?.pip }}
                      aria-hidden
                    />
                  )}
                  <div className="collection-list-main">
                    <div className="collection-list-name">
                      {r.card.name}
                      {r.card.foil && <span className="card-list-foil-tag">foil</span>}
                      <DeckBadge allocations={allocationsFor(r.card)} />
                      <BinderBadge binders={r.binders} />
                    </div>
                    <div className="collection-list-meta">
                      <span className="card-list-set-code">{r.card.setCode.toUpperCase()}</span>
                      <span className="card-list-cn">#{r.card.collectorNumber}</span>
                    </div>
                  </div>
                  {r.card.manaCost ? (
                    <ManaCost cost={r.card.manaCost} className="mana-cost-row" />
                  ) : (
                    <span className="mana-cost-row" aria-hidden />
                  )}
                  <div className="collection-list-right">
                    <CardRowMenu
                      card={r.card}
                      onEditCard={() => setEditingCard(r.card)}
                      onDelete={() => handleDeleteRow(r)}
                      currentBinder={
                        r.binderId && r.binderName
                          ? { id: r.binderId, name: r.binderName, color: r.binderColor }
                          : null
                      }
                    />
                    <div className="collection-list-qty">×{r.qty}</div>
                    <div className="collection-list-price">
                      ${(r.card.purchasePrice * r.qty).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view !== 'grid' && showScryfallTrigger && (
        <button
          type="button"
          className="collection-list-scryfall collection-list-scryfall--standalone"
          aria-expanded={false}
          aria-label={`Search Scryfall for ${debouncedSearch.trim()}`}
          onClick={() => setScryfallOpen(true)}
        >
          <span className="collection-list-scryfall-icon">
            <Search width={18} height={18} strokeWidth={1.7} aria-hidden />
          </span>
          <span className="collection-list-scryfall-text">
            <span className="collection-list-scryfall-title">Search Scryfall</span>
            <span className="collection-list-scryfall-sub">for “{debouncedSearch.trim()}”</span>
          </span>
        </button>
      )}

      {scryfallOpen && showScryfall && (
        <InlineCardSearch query={debouncedSearch.trim()} onClose={() => setScryfallOpen(false)} />
      )}

      {shortcutsOpen && (
        <KeyboardShortcutsOverlay
          onClose={() => setShortcutsOpen(false)}
          groups={[
            {
              title: 'Navigation',
              shortcuts: [
                { keys: ['/'], description: 'Focus search' },
                { keys: ['?'], description: 'Show keyboard shortcuts' },
                { keys: ['Esc'], description: 'Close dialogs and overlays' },
              ],
            },
            {
              title: 'View',
              shortcuts: [
                { keys: ['g'], description: 'Switch to grid view' },
                { keys: ['l'], description: 'Switch to list view' },
                { keys: ['c'], description: 'Switch to compact list' },
              ],
            },
          ]}
        />
      )}

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={editingQty}
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
