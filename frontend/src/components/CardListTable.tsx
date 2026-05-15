import { AlignJustify, LayoutGrid, List as ListIconLucide } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
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
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { ManaCost } from './ManaCost';
import { DeckBadge } from './DeckBadge';
import { BinderBadge, type BinderInfo } from './BinderBadge';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { ViewModeToggle } from './ViewModeToggle';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';
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
  exactMatchesExpression,
  isExpressionEmpty,
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
type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'cmc';

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
];

const SORT_KEY_TO_FIELD: Record<SortKey, SortField> = {
  name: 'name',
  set: 'setName',
  rarity: 'rarity',
  price: 'price',
  qty: 'quantity',
  cmc: 'cmc',
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

export function CardListTable({ cards, binders, setMap, hideBinderFilter = false }: Props) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
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
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

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

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !r.card.name.toLowerCase().includes(q) &&
        !r.card.setCode.toLowerCase().includes(q) &&
        !(r.card.typeLine || '').toLowerCase().includes(q)
      )
        return false;
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

  // Scroll to top when filters, sort, or view mode change.
  const resetKey = `${debouncedSearch}|${sortKey}|${sortDir}|${view}`;
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      window.scrollTo({ top: 0 });
    }
  }, [resetKey]);

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

  const gridRowCount = view === 'grid' ? Math.ceil(sorted.length / gridCols) : 0;
  const GRID_GAP = 10;

  const estimateGridRowHeight = useCallback(() => {
    if (!gridContainerRef.current) return 250;
    const w = gridContainerRef.current.clientWidth;
    const colWidth = (w - GRID_GAP * (gridCols - 1)) / gridCols;
    return colWidth * (680 / 488) + GRID_GAP;
  }, [gridCols]);

  const listVirtualizer = useWindowVirtualizer({
    count: view !== 'grid' ? sorted.length : 0,
    estimateSize: () => (view === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_LIST),
    overscan: 20,
  });

  const gridVirtualizer = useWindowVirtualizer({
    count: gridRowCount,
    estimateSize: estimateGridRowHeight,
    overscan: 8,
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
      imageNormalBack: sc.card_faces?.[1]?.image_uris?.normal,
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

  // Count active filter *groups*, not individual chips — five colors
  // selected is still one filter group, so the badge stays glanceable.
  const activeFilterCount =
    (!isExpressionEmpty(supertypeExpr) ? 1 : 0) +
    (!isExpressionEmpty(typesExpr) ? 1 : 0) +
    (!isExpressionEmpty(subtypeExpr) ? 1 : 0) +
    (colorFilter.size > 0 ? 1 : 0) +
    (!isExpressionEmpty(rarityExpr) ? 1 : 0) +
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

      {previewIndex !== null && sorted[previewIndex] && (
        <CardPreview
          cards={sorted.map((r) => r.card)}
          index={previewIndex}
          binderName="Collection"
          sectionLabels={sorted.map((r) => (r.binders.length === 0 ? 'Uncategorized' : ''))}
          pageNumbers={sorted.map(() => 0)}
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

      {sorted.length === 0 ? (
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
            const rowItems = sorted.slice(startIdx, startIdx + gridCols);
            return (
              <div
                key={virtualRow.key}
                className="collection-grid-vrow"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gap: `${GRID_GAP}px`,
                }}
              >
                {rowItems.map((r, colIdx) => {
                  const idx = startIdx + colIdx;
                  const foilStyle = classifyFoil(r.card);
                  const foilClass = foilStyle !== 'none' ? ` is-foil foil-${foilStyle}` : '';
                  return (
                    <div
                      key={r.key}
                      role="button"
                      tabIndex={0}
                      className={`collection-grid-item grid-${effectiveGridSize}${foilClass}`}
                      onClick={() => setPreviewIndex(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPreviewIndex(idx);
                        }
                      }}
                      aria-label={`${r.card.name}, quantity ${r.qty}${r.card.foil ? ', foil' : ''}`}
                    >
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
      ) : (
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
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="collection-list-row"
                  role="row"
                  tabIndex={0}
                  onClick={() => setPreviewIndex(virtualRow.index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPreviewIndex(virtualRow.index);
                    }
                  }}
                >
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
                      <ManaCost cost={r.card.manaCost} />
                    </div>
                  </div>
                  <div className="collection-list-right">
                    <CardRowMenu
                      card={r.card}
                      onEditCard={() => setEditingCard(r.card)}
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
    </div>
  );
}
