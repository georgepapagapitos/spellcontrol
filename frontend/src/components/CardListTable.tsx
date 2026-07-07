import {
  AlignJustify,
  Bookmark,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  LayoutGrid,
  Layers,
  List as ListIconLucide,
  ListPlus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollContainer } from '../lib/scroll-container';
import { formatMoney } from '../lib/format-money';
import type {
  BinderFilter,
  ChipExpression,
  EnrichedCard,
  MaterializedBinder,
  ScryfallQueryRule,
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
import { useRegisterShortcuts, isTypingTarget } from '../lib/shortcut-registry';
import { setSymbolTitle } from '../lib/set-symbols';
import { DeckBadge } from './DeckBadge';
import { Legend } from './Legend';
import { BinderBadge, type BinderInfo } from './BinderBadge';
import { useAllocations, computeSurplusByName, type AllocationInfo } from '../lib/allocations';
import { ViewModeToggle } from './ViewModeToggle';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';
import { SaveToListDialog } from './SaveToListDialog';
import { useCardsWithTags, cardTagLabel } from '../lib/card-tags';
import { InlineCardSearch } from './InlineCardSearch';
import { SortDirArrow } from './SortDirArrow';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { classifyFoil } from '../lib/foil-style';
import { sortCards, printingKey, type SortContext } from '../lib/sorting';
import { getSectionMeta } from '@spellcontrol/binder-routing';
import {
  groupRowsIntoSections,
  buildGridLayout,
  buildListLayout,
  type SectionHeader,
  type GridLayoutRow,
  type ListLayoutRow,
} from '../lib/group-sections';
import { readLocalStorage } from '../lib/local-storage';
import { getColorKey } from '../lib/colors';
import { useCollectionStore } from '../store/collection';
import {
  collectionFiltersToFilterGroup,
  deriveBinderName,
  hasStructuredFilter,
} from '../lib/collection-filters-to-binder';
import { fetchTypeSuggestions } from '../lib/scryfall-catalog';
import { parseTypeLine, SUPERTYPES, TYPES } from '../lib/card-types';
import { CardRow } from './shared/CardRow';
import { RarityBadge } from './shared/RarityBadge';
import { buildEditedCards } from '../lib/edit-card';
import {
  compileExpression,
  compileFilter,
  cardMatchesCompiled,
  exactMatchesExpression,
  isExpressionEmpty,
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

/** Shortcut items contributed to the registry under the "Collection" section. */
const COLLECTION_SHORTCUTS = [
  { keys: ['/'], description: 'Focus search' },
  { keys: ['g'], description: 'Switch to grid view' },
  { keys: ['l'], description: 'Switch to list view' },
  { keys: ['c'], description: 'Switch to compact list' },
];

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
type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'cmc' | 'release' | 'added' | 'edited';

const ROW_HEIGHT_LIST = 66;
const ROW_HEIGHT_COMPACT = 32;
// Fixed height of a full-width "Group by" section header row in grid view.
// Keep in sync with .collection-grid-section-header in styles/collection.css.
const GRID_SECTION_HEADER_H = 40;

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
  { key: 'cmc', label: 'Mana value', defaultDir: 'asc' },
  { key: 'price', label: 'Price', defaultDir: 'desc' },
  { key: 'qty', label: 'Quantity', defaultDir: 'desc' },
  { key: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { key: 'set', label: 'Set', defaultDir: 'asc' },
  { key: 'release', label: 'Release date', defaultDir: 'desc' },
  { key: 'added', label: 'Date added', defaultDir: 'desc' },
  { key: 'edited', label: 'Last edited', defaultDir: 'desc' },
];

const SORT_KEY_TO_FIELD: Record<SortKey, SortField> = {
  name: 'name',
  set: 'setName',
  rarity: 'rarity',
  price: 'price',
  qty: 'quantity',
  cmc: 'cmc',
  release: 'setReleaseDate',
  added: 'dateAdded',
  edited: 'dateEdited',
};

const SORT_FIELD_BY_KEY: Record<SortKey, (typeof SORT_FIELDS)[number]> = SORT_FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<SortKey, (typeof SORT_FIELDS)[number]>
);

// "Group by" sections the visible rows under per-attribute headers, reusing the
// binder-routing sectioning engine (getSectionMeta) so the buckets/labels/order
// match how binders already section the same cards. Applies to all three views
// (list/compact inline headers; grid full-width header rows via buildGridLayout).
type GroupKey = 'none' | 'color' | 'type' | 'cmc' | 'rarity' | 'set';

const GROUP_FIELDS: Array<{ key: GroupKey; label: string }> = [
  { key: 'none', label: 'No grouping' },
  { key: 'color', label: 'Color' },
  { key: 'type', label: 'Type' },
  { key: 'cmc', label: 'Mana value' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'set', label: 'Set' },
];

// Map each group choice to the binder-routing SortField getSectionMeta keys off.
// "set" uses setReleaseDate (not setName) so sections order chronologically;
// setName returns order:0 for every set, leaving the order to alphabetical-by-key.
const GROUP_KEY_TO_FIELD: Record<Exclude<GroupKey, 'none'>, SortField> = {
  color: 'color',
  type: 'type',
  cmc: 'cmc',
  rarity: 'rarity',
  set: 'setReleaseDate',
};

// Per-group-field localStorage key for the set of collapsed section keys, so a
// "Red" fold under Color grouping is remembered independently of a "Lands" fold
// under Type grouping.
const COLLAPSED_KEY_PREFIX = 'spellcontrol:collection:collapsed:';
const loadCollapsedKeys = (g: GroupKey): Set<string> =>
  g === 'none'
    ? new Set()
    : new Set(readLocalStorage<string[]>(COLLAPSED_KEY_PREFIX + g, JSON.parse, []));
const persistCollapsedKeys = (g: GroupKey, keys: Set<string>) => {
  if (g === 'none') return;
  try {
    localStorage.setItem(COLLAPSED_KEY_PREFIX + g, JSON.stringify([...keys]));
  } catch {
    /* ignore – SSR / private-browsing / quota errors */
  }
};

// Shared section-header bar: a disclosure button (chevron + pip + label + count)
// reused by the inline list/grid headers and the floating sticky overlay. The
// `className` carries the per-surface look; this adds the button reset, the
// rotating chevron, and the expanded/collapsed a11y state.
function SectionHeaderBar({
  pip,
  label,
  count,
  collapsed,
  onToggle,
  className,
  style,
  tabIndex,
}: {
  pip: SectionHeader['meta']['pip'];
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  className: string;
  style?: CSSProperties;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      className={`${className} collection-section-header-btn`}
      style={style}
      tabIndex={tabIndex}
      aria-expanded={!collapsed}
      aria-label={`${label}, ${count} cards, ${collapsed ? 'collapsed' : 'expanded'}`}
      onClick={onToggle}
    >
      <ChevronDown
        className="collection-section-chevron"
        width={16}
        height={16}
        strokeWidth={2.25}
        aria-hidden
        data-collapsed={collapsed || undefined}
      />
      {pip && (
        <span
          className="collection-list-section-pip"
          style={{ background: pip.background, borderColor: pip.border }}
          aria-hidden
        />
      )}
      <span className="collection-list-section-label">{label}</span>
      <span className="collection-list-section-count">{count}</span>
    </button>
  );
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
  // Tradeable-surplus filter: rows whose card name has ≥1 unallocated copy
  // beyond the keep floor (see computeSurplusByName). Independent of
  // groupPrintings — works whether rows are per-printing or per-copy.
  const [surplusOnly, setSurplusOnly] = useState(false);
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
    // Cancelled on unmount: the catalog promise can outlive the component
    // (flaked CI — a setState after vitest tore the DOM env down).
    let cancelled = false;
    fetchTypeSuggestions().then((catalog) => {
      if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Register the Collection shortcut section while this table is mounted.
  // The `?` overlay is owned by Layout; we contribute our shortcuts to the
  // registry so they appear under the "Collection" section automatically.
  useRegisterShortcuts('Collection', COLLECTION_SHORTCUTS);

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

  // Decorate cards with Scryfall oracle tags only when the live filter uses a
  // tag chip — otherwise this is a zero-cost pass-through (the snapshot isn't
  // even loaded). Needed because the collection matcher reads `card.tags`, and
  // CollectionPage only decorates when an existing binder uses tags.
  const cardsForMatch = useCardsWithTags(cards, !isExpressionEmpty(oracleTagExpr));

  // Hoisted ahead of `rows`/`filtered` (below, other collection-store reads
  // stay near their non-filter usages further down) so the surplus predicate
  // can run in the same filter pass as the binder/color/condition post-checks.
  const allCards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  // Card names with unallocated copies beyond the keep floor — the
  // "tradeable surplus" predicate. Computed over the full collection (not
  // just `cards`/`cardsForMatch`, which can be a binder-scoped subset) so a
  // spare copy sitting in a different binder still counts.
  const surplusByName = useMemo(
    () => computeSurplusByName(allCards, allocations),
    [allCards, allocations]
  );

  const rows = useMemo<Row[]>(() => {
    if (!groupPrintings) {
      // One row per physical copy.
      return cardsForMatch.map((card) => {
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
    for (const card of cardsForMatch) {
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
  }, [cardsForMatch, cardToBinder, groupPrintings]);

  // Binder membership and condition are collection-only post-checks that don't
  // map directly to BinderFilter fields, so they're compiled separately.
  const compiledBinder = useMemo(() => compileExpression(binderExpr), [binderExpr]);
  const compiledCondition = useMemo(() => compileExpression(conditionExpr), [conditionExpr]);

  // Build a BinderFilter from all the non-collection-specific filter state and
  // let the engine handle matching — eliminates the 11 individual compilations
  // and the hand-rolled per-field checks from the old filtered useMemo.
  const compiledMatchFilter = useMemo(() => {
    const f: BinderFilter = {};
    if (!isExpressionEmpty(supertypeExpr)) f.supertypeChips = supertypeExpr;
    if (!isExpressionEmpty(typesExpr)) f.typeTokenChips = typesExpr;
    if (!isExpressionEmpty(subtypeExpr)) f.subtypeChips = subtypeExpr;
    if (!isExpressionEmpty(rarityExpr)) f.rarities = rarityExpr;
    if (!isExpressionEmpty(oracleExpr)) f.oracleChips = oracleExpr;
    if (!isExpressionEmpty(oracleTagExpr)) f.oracleTagChips = oracleTagExpr;
    if (scryfallQuery) f.scryfallQuery = scryfallQuery;
    if (!isExpressionEmpty(legalityExpr)) f.legalities = legalityExpr;
    if (!isExpressionEmpty(layoutExpr)) f.layouts = layoutExpr;
    if (!isExpressionEmpty(treatmentExpr)) f.treatments = treatmentExpr;
    if (!isExpressionEmpty(borderExpr)) f.borderColors = borderExpr;
    if (!isExpressionEmpty(finishExpr)) f.finishes = finishExpr;
    if (setFilter.size > 0) f.setCodes = [...setFilter].map((s) => s.toUpperCase());
    if (priceMin !== undefined) f.priceMin = priceMin;
    if (priceMax !== undefined) f.priceMax = priceMax;
    if (cmcMin !== undefined) f.cmcMin = cmcMin;
    if (cmcMax !== undefined) f.cmcMax = cmcMax;
    const trimmed = debouncedSearch.trim();
    if (trimmed) f.nameContains = trimmed;
    return compileFilter(f);
  }, [
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
  ]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        // Post-check 1: binder membership (collection-only)
        if (compiledBinder) {
          const bname = r.binderName ?? '__uncategorized';
          if (!exactMatchesExpression(bname, compiledBinder)) return false;
        }
        // Post-check 2: color identity (collection-only, different semantics than engine)
        if (colorFilter.size > 0) {
          const k = getColorKey(r.card);
          const ci = r.card.colorIdentity || [];
          const matches =
            (k === 'C' && colorFilter.has('C')) ||
            ci.some((c) => colorFilter.has(c)) ||
            (k !== 'C' && colorFilter.has(k));
          if (!matches) return false;
        }
        // Post-check 3: condition (collection-only, physical copy field)
        if (compiledCondition && !exactMatchesExpression(r.card.condition, compiledCondition))
          return false;
        // Post-check 4: tradeable surplus (collection-only, needs allocation data)
        if (surplusOnly && !surplusByName.has(r.card.name)) return false;
        // Engine check: everything else (type, rarity, oracle, legality, layout,
        // treatment, border, finish, sets, price, cmc, name search)
        return cardMatchesCompiled(r.card, compiledMatchFilter);
      }),
    [
      rows,
      compiledBinder,
      colorFilter,
      compiledCondition,
      surplusOnly,
      surplusByName,
      compiledMatchFilter,
    ]
  );

  const sorted = useMemo(() => {
    const field: SortField = SORT_KEY_TO_FIELD[sortKey];
    const dir: SortDir = sortDir;
    // Map row.qty into a printing-keyed table so the shared comparator's
    // "quantity" sort uses the displayed (rolled-up or per-copy) qty.
    const qtyByPrintingKey = new Map<string, number>();
    for (const r of filtered) qtyByPrintingKey.set(printingKey(r.card), r.qty);
    // Import timestamp per importId, for the "Date added" sort (whole-import
    // granularity; cards predating the importId field sort as oldest).
    const addedAtByImportId = new Map(importHistory.map((e) => [e.id, e.addedAt]));
    const ctx: SortContext = { setMap, qtyByPrintingKey, addedAtByImportId };
    const sortedCards = sortCards(
      filtered.map((r) => r.card),
      [{ field, dir }],
      ctx
    );
    const byCopyId = new Map(filtered.map((r) => [r.card.copyId, r]));
    return sortedCards.map((c) => byCopyId.get(c.copyId)!).filter(Boolean) as Row[];
  }, [filtered, sortKey, sortDir, setMap, importHistory]);

  // "Group by" re-buckets the already-sorted rows under per-attribute section
  // headers. We stable-group `sorted` (within-group order = the user's sort) so
  // grouping composes with sorting. Applies to all three views — list/compact
  // render headers inline in the boundary row's measured cell, grid renders them
  // as full-width rows via `gridLayout` below. Everything downstream (the
  // carousel, the Scryfall trigger index, the virtualizers) indexes off
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
  const triggerIndex = displayRows.length;
  const GRID_GAP = 10;

  // Heterogeneous grid row list: full-width section headers interleaved with
  // chunked card rows. The Scryfall "add" trigger rides as one trailing item.
  const gridLayout = useMemo<GridLayoutRow[]>(
    () =>
      view === 'grid'
        ? buildGridLayout(
            displayRows.length,
            gridCols,
            sectionHeaders,
            showScryfallTrigger ? 1 : 0,
            collapsedKeys
          )
        : [],
    [view, displayRows.length, gridCols, sectionHeaders, showScryfallTrigger, collapsedKeys]
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

  // When the query is cleared (or drops below the 2-char threshold), leave
  // search mode so the next real query starts from the trigger box again
  // rather than silently reopening the results panel.
  useEffect(() => {
    if (!showScryfall) setScryfallOpen(false);
  }, [showScryfall]);

  // Per-index height estimate: section headers are a fixed short row, card rows
  // derive from the live column width (exact aspect ratio), so the grid stays
  // measureElement-free — the estimate is the truth and offsets never drift.
  const estimateGridRowHeight = useCallback(
    (index: number) => {
      if (gridLayout[index]?.kind === 'header') return GRID_SECTION_HEADER_H;
      if (!gridContainerRef.current) return 250;
      const w = gridContainerRef.current.clientWidth;
      const colWidth = (w - GRID_GAP * (gridCols - 1)) / gridCols;
      return colWidth * (680 / 488) + GRID_GAP;
    },
    [gridCols, gridLayout]
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
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
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
      return view === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_LIST;
    },
    [listLayout, view]
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
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const lists = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const addListEntries = useCollectionStore((s) => s.addListEntries);
  const [saveToListOpen, setSaveToListOpen] = useState(false);
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
    // Single-copy edit re-points just this one copy, leaving siblings on the old
    // printing — that's how a stack of identical printings gets split.
    const copyId = editingSingle ? editingCard.copyId : undefined;
    replaceAllCards(buildEditedCards(editingCard, selection, allCards, copyId));
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
    (!isExpressionEmpty(oracleTagExpr) ? 1 : 0) +
    (scryfallQuery ? 1 : 0) +
    (!isExpressionEmpty(legalityExpr) ? 1 : 0) +
    (!isExpressionEmpty(layoutExpr) ? 1 : 0) +
    (!isExpressionEmpty(treatmentExpr) ? 1 : 0) +
    (!isExpressionEmpty(borderExpr) ? 1 : 0) +
    (!isExpressionEmpty(finishExpr) ? 1 : 0) +
    (!isExpressionEmpty(conditionExpr) ? 1 : 0) +
    (!isExpressionEmpty(binderExpr) ? 1 : 0) +
    (setFilter.size > 0 ? 1 : 0) +
    (priceMin !== undefined || priceMax !== undefined ? 1 : 0) +
    (cmcMin !== undefined || cmcMax !== undefined ? 1 : 0) +
    (groupPrintings ? 0 : 1) +
    (surplusOnly ? 1 : 0);

  // Empty chip expression reused for clearing chip-based filters.
  // Stable reference (same shape every time) — memoized so the
  // chips useMemo dependency doesn't trigger on every render.
  const EMPTY_EXPR = useMemo<ChipExpression>(() => ({ chips: [], joiners: [] }), []);

  // Whether at least one STRUCTURED filter (not just a search term) is active.
  // Used to gate the "Save as binder" button.
  // Note: condition and binder filters are deliberately excluded from hasStructuredFilter
  // because they can't be mapped to a binder rule — so those filters alone won't
  // enable the button.
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
            : `Already in “${name}” — nothing to add`,
        tone: added > 0 ? 'success' : 'info',
      });
    },
    [createList, addListEntries, saveToListCards, pushToast]
  );

  // Clear all active filters and the search term at once.
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setColorFilter(new Set());
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
    setBinderExpr(EMPTY_EXPR);
    setSetFilter(new Set());
    setGroupPrintings(true);
    setSurplusOnly(false);
    setPriceMin(undefined);
    setPriceMax(undefined);
    setCmcMin(undefined);
    setCmcMax(undefined);
  }, [EMPTY_EXPR]);

  // Build the active-filter chip descriptors — one per non-empty filter group.
  // Each chip knows how to clear its own slice so × on a chip is surgical.
  // The chips are derived state; the single place that maps filter state →
  // human labels avoids scattering label strings across the JSX.
  type FilterChip = {
    id: string;
    label: string;
    onClear: () => void;
  };
  const activeFilterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];

    if (search.trim()) {
      chips.push({
        id: 'search',
        label: `"${search.trim()}"`,
        onClear: () => setSearch(''),
      });
    }
    if (colorFilter.size > 0) {
      const colorMap: Record<string, string> = {
        W: 'White',
        U: 'Blue',
        B: 'Black',
        R: 'Red',
        G: 'Green',
        C: 'Colorless',
      };
      const labels = [...colorFilter].map((k) => colorMap[k] ?? k).join(', ');
      chips.push({
        id: 'color',
        label: `Color: ${labels}`,
        onClear: () => setColorFilter(new Set()),
      });
    }
    if (!isExpressionEmpty(rarityExpr)) {
      const labels = rarityExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not ${c.value}` : c.value))
        .join(', ');
      chips.push({
        id: 'rarity',
        label: `Rarity: ${labels}`,
        onClear: () => setRarityExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(supertypeExpr)) {
      const labels = supertypeExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not ${c.value}` : c.value))
        .join(', ');
      chips.push({
        id: 'supertype',
        label: `Supertype: ${labels}`,
        onClear: () => setSupertypeExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(typesExpr)) {
      const labels = typesExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not ${c.value}` : c.value))
        .join(', ');
      chips.push({
        id: 'type',
        label: `Type: ${labels}`,
        onClear: () => setTypesExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(subtypeExpr)) {
      const labels = subtypeExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not ${c.value}` : c.value))
        .join(', ');
      chips.push({
        id: 'subtype',
        label: `Subtype: ${labels}`,
        onClear: () => setSubtypeExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(oracleExpr)) {
      const labels = oracleExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not "${c.value}"` : `"${c.value}"`))
        .join(', ');
      chips.push({
        id: 'oracle',
        label: `Text: ${labels}`,
        onClear: () => setOracleExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(oracleTagExpr)) {
      const labels = oracleTagExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => (c.negate ? `not ${cardTagLabel(c.value)}` : cardTagLabel(c.value)))
        .join(', ');
      chips.push({
        id: 'oracleTag',
        label: `Tags: ${labels}`,
        onClear: () => setOracleTagExpr(EMPTY_EXPR),
      });
    }
    if (scryfallQuery) {
      chips.push({
        id: 'scryfallQuery',
        label: `Scryfall: ${scryfallQuery.query}`,
        onClear: () => setScryfallQuery(undefined),
      });
    }
    if (!isExpressionEmpty(legalityExpr)) {
      const labels = legalityExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'legality',
        label: `Legal in: ${labels}`,
        onClear: () => setLegalityExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(layoutExpr)) {
      const labels = layoutExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'layout',
        label: `Layout: ${labels}`,
        onClear: () => setLayoutExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(treatmentExpr)) {
      const labels = treatmentExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'treatment',
        label: `Treatment: ${labels}`,
        onClear: () => setTreatmentExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(borderExpr)) {
      const labels = borderExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'border',
        label: `Border: ${labels}`,
        onClear: () => setBorderExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(finishExpr)) {
      const labels = finishExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'finish',
        label: `Finish: ${labels}`,
        onClear: () => setFinishExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(conditionExpr)) {
      const labels = conditionExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'condition',
        label: `Condition: ${labels}`,
        onClear: () => setConditionExpr(EMPTY_EXPR),
      });
    }
    if (!isExpressionEmpty(binderExpr)) {
      const labels = binderExpr.chips
        .filter((c) => c.value.trim())
        .map((c) => c.value)
        .join(', ');
      chips.push({
        id: 'binder',
        label: `Binder: ${labels}`,
        onClear: () => setBinderExpr(EMPTY_EXPR),
      });
    }
    if (setFilter.size > 0) {
      const labels = [...setFilter].join(', ');
      chips.push({
        id: 'set',
        label: `Set: ${labels}`,
        onClear: () => setSetFilter(new Set()),
      });
    }
    if (priceMin !== undefined || priceMax !== undefined) {
      const label =
        priceMin !== undefined && priceMax !== undefined
          ? `Price: ${formatMoney(priceMin)}–${formatMoney(priceMax)}`
          : priceMin !== undefined
            ? `Price: ≥ ${formatMoney(priceMin)}`
            : `Price: ≤ ${formatMoney(priceMax)}`;
      chips.push({
        id: 'price',
        label,
        onClear: () => {
          setPriceMin(undefined);
          setPriceMax(undefined);
        },
      });
    }
    if (cmcMin !== undefined || cmcMax !== undefined) {
      const label =
        cmcMin !== undefined && cmcMax !== undefined
          ? `Mana value: ${cmcMin}–${cmcMax}`
          : cmcMin !== undefined
            ? `Mana value: ≥ ${cmcMin}`
            : `Mana value: ≤ ${cmcMax}`;
      chips.push({
        id: 'cmc',
        label,
        onClear: () => {
          setCmcMin(undefined);
          setCmcMax(undefined);
        },
      });
    }
    if (!groupPrintings) {
      chips.push({
        id: 'groupPrintings',
        label: 'All copies shown',
        onClear: () => setGroupPrintings(true),
      });
    }
    if (surplusOnly) {
      chips.push({
        id: 'surplus',
        label: 'Surplus only',
        onClear: () => setSurplusOnly(false),
      });
    }
    return chips;
  }, [
    search,
    colorFilter,
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
    binderExpr,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    surplusOnly,
    groupPrintings,
    EMPTY_EXPR,
  ]);

  // Selection copy count (for the "N rows · M copies" selection display).
  const selectedCopiesCount = useMemo(() => {
    if (selectedRowKeys.size === 0) return 0;
    return sorted.filter((r) => selectedRowKeys.has(r.key)).reduce((sum, r) => sum + r.qty, 0);
  }, [sorted, selectedRowKeys]);

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
              activeCount={activeFilterCount}
            />
          }
        />
      </div>

      {/* Active filter chips — scrolls with content (non-sticky), appears
          between the search bar and the controls row. One chip per active
          filter group; × on a chip clears just that slice. Only renders
          when at least one filter or search is active. */}
      {activeFilterChips.length > 0 && (
        <div className="collection-filter-chips" role="group" aria-label="Active filters">
          {activeFilterChips.map((chip) => (
            <span key={chip.id} className="collection-filter-chip">
              <span className="collection-filter-chip-label">{chip.label}</span>
              <button
                type="button"
                className="collection-filter-chip-clear"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={chip.onClear}
              >
                <X width={12} height={12} strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          ))}
          {activeFilterChips.length > 1 && (
            <button
              type="button"
              className="collection-filter-chips-clear-all"
              onClick={clearAllFilters}
            >
              Clear all
            </button>
          )}
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
        </div>
      )}

      {saveToListOpen && (
        <SaveToListDialog
          cardCount={saveToListCards.length}
          lists={lists}
          onSubmit={handleSaveToList}
          onCancel={() => setSaveToListOpen(false)}
        />
      )}

      {/* Sort/group/view controls — sticky beneath the search bar.
          A control row (STYLE_GUIDE "Toolbars & action rows") → flex-wrap,
          never clips. The --z-popover tier matches the search bar so neither
          row "wins" against the other — they form one sticky stack. */}
      <div ref={controlsRowRef} className="card-list-summary-line card-list-controls-sticky">
        <div className="card-list-summary-actions">
          {/* Result count — only when filters/search narrow the set */}
          {(activeFilterCount > 0 || search.trim()) && sorted.length < rows.length && (
            <span className="card-list-result-count" aria-live="polite">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} cards
            </span>
          )}
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
          <SelectMenu<GroupKey>
            ariaLabel="Group by"
            value={groupKey}
            options={GROUP_FIELDS.map((f) => ({ value: f.key, label: f.label }))}
            onChange={setGroupKey}
            leadingIcon={<Layers width={14} height={14} strokeWidth={2} aria-hidden />}
          />
          {groupKey !== 'none' && allSectionKeys.length > 0 && (
            <button
              type="button"
              className="toolbar-pill"
              aria-pressed={allCollapsed}
              onClick={toggleAllCollapsed}
              title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
            >
              {allCollapsed ? (
                <ChevronsUpDown width={14} height={14} strokeWidth={2} aria-hidden />
              ) : (
                <ChevronsDownUp width={14} height={14} strokeWidth={2} aria-hidden />
              )}
              <span>{allCollapsed ? 'Expand all' : 'Collapse all'}</span>
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
          <Legend context="collection" align="right" variant="pill" />
        </div>
      </div>

      {selectMode && (
        <div className="card-list-bulk-toolbar" role="region" aria-label="Bulk actions">
          <span className="card-list-bulk-count">
            {selectedRowKeys.size > 0
              ? `${selectedRowKeys.size} ${selectedRowKeys.size === 1 ? 'row' : 'rows'} · ${selectedCopiesCount} ${selectedCopiesCount === 1 ? 'copy' : 'copies'}`
              : 'Select cards…'}
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

      {/* Sticky section overlay — floats below the sticky controls and swaps its
          label as the active section changes on scroll. Tapping it folds/unfolds
          that section, mirroring the inline header. */}
      {groupKey !== 'none' && activeSectionIdx >= 0 && boundaries[activeSectionIdx] && (
        <div
          className="collection-section-sticky-header"
          style={{ top: controlsBottom > 0 ? controlsBottom : undefined }}
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
          getStackQty={(i) => displayRows[i]?.qty ?? 1}
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
          <button type="button" className="btn empty-state-action" onClick={clearAllFilters}>
            Clear filters
          </button>
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
            const layoutRow = gridLayout[virtualRow.index];
            if (!layoutRow) return null;
            if (layoutRow.kind === 'header') {
              return (
                <SectionHeaderBar
                  key={virtualRow.key}
                  className="collection-grid-section-header"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: GRID_SECTION_HEADER_H,
                    transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  }}
                  pip={layoutRow.meta.pip}
                  label={layoutRow.meta.label}
                  count={layoutRow.count}
                  collapsed={collapsedKeys.has(layoutRow.meta.key)}
                  onToggle={() => toggleCollapsed(layoutRow.meta.key)}
                />
              );
            }
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
                {Array.from({ length: layoutRow.end - layoutRow.start }, (_, colIdx) => {
                  const idx = layoutRow.start + colIdx;
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
                  if (idx >= displayRows.length) return null;
                  const r = displayRows[idx];
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
                      <RarityBadge rarity={r.card.rarity} className="collection-grid-rarity" />
                      {(r.qty > 1 ||
                        duplicateNames.has(r.card.name) ||
                        (surplusOnly && surplusByName.has(r.card.name))) && (
                        <div className="collection-grid-corner">
                          {r.qty > 1 && (
                            <span className="collection-grid-qty">
                              <span className="collection-grid-qty-x" aria-hidden="true">
                                ×
                              </span>
                              {r.qty}
                            </span>
                          )}
                          {duplicateNames.has(r.card.name) && (
                            <span
                              className="collection-grid-set"
                              title={setSymbolTitle({
                                setCode: r.card.setCode,
                                setName:
                                  r.card.setName || setMap?.[r.card.setCode.toUpperCase()]?.name,
                                collectorNumber: r.card.collectorNumber,
                                rarity: r.card.rarity,
                              })}
                            >
                              {r.card.setCode.toUpperCase()}
                            </span>
                          )}
                          {surplusOnly && surplusByName.has(r.card.name) && (
                            <span
                              className="collection-grid-surplus"
                              title={`${surplusByName.get(r.card.name)} unallocated ${
                                surplusByName.get(r.card.name) === 1 ? 'copy' : 'copies'
                              } beyond your kept copy`}
                            >
                              {surplusByName.get(r.card.name)} free
                            </span>
                          )}
                        </div>
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
            const item = listLayout[virtualRow.index];
            if (!item) return null;
            // Headers ride as their own measured virtual rows (mirroring the
            // grid), so a collapsed section keeps a tappable header with no card
            // rows below it. `measureElement` folds each row's real height into
            // the offset, so a header row and a card row can differ in height
            // without drift.
            const rowBox = (children: ReactNode) => (
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
                {children}
              </div>
            );
            if (item.kind === 'header') {
              return rowBox(
                <SectionHeaderBar
                  className="collection-list-section-header"
                  pip={item.meta.pip}
                  label={item.meta.label}
                  count={item.count}
                  collapsed={collapsedKeys.has(item.meta.key)}
                  onToggle={() => toggleCollapsed(item.meta.key)}
                />
              );
            }
            const r = displayRows[item.index];
            const selected = selectedRowKeys.has(r.key);
            return rowBox(
              <CardRow
                card={r.card}
                qty={r.qty}
                allocations={allocationsFor(r.card)}
                binders={r.binders}
                surplusCount={surplusOnly ? surplusByName.get(r.card.name) : undefined}
                setName={r.card.setName || setMap?.[r.card.setCode.toUpperCase()]?.name}
                isLastRow={item.index === displayRows.length - 1}
                selectMode={selectMode}
                selected={selected}
                pricePending={isRefreshingPrices && !((r.card.purchasePrice ?? 0) > 0)}
                onActivate={() => (selectMode ? toggleRow(r.key) : setPreviewIndex(item.index))}
                menu={
                  <CardRowMenu
                    card={r.card}
                    onEditCard={() => openEdit(r.card, !groupPrintings)}
                    onSplitCopy={
                      groupPrintings && r.qty >= 2 ? () => openEdit(r.card, true) : undefined
                    }
                    onDelete={() => handleDeleteRow(r)}
                    currentBinder={
                      r.binderId && r.binderName
                        ? { id: r.binderId, name: r.binderName, color: r.binderColor }
                        : null
                    }
                  />
                }
              />
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

      {editingCard && (
        <CardEditDialog
          cardName={editingCard.name}
          currentScryfallId={editingCard.scryfallId}
          currentFinish={editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil')}
          quantity={editingSingle ? undefined : editingQty}
          singleCopy={editingSingle}
          details={{
            condition: editingCard.condition,
            language: editingCard.language,
            altered: editingCard.altered,
            proxy: editingCard.proxy,
            misprint: editingCard.misprint,
          }}
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
