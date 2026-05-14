import { AlignJustify, BarChart3, LayoutGrid, List as ListIconLucide } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { BinderBadge } from './BinderBadge';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { ViewModeToggle } from './ViewModeToggle';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';
import { SortDirArrow } from './SortDirArrow';
import { useDebouncedValue } from '../lib/use-debounced-value';
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
  /**
   * Opens the collection breakdown drawer (Colors / Types / Rarity).
   * When omitted, the Stats button in the sticky toolbar is hidden —
   * binder-scoped views don't have a breakdown drawer of their own.
   */
  onOpenStats?: () => void;
}

interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  binderId: string | null;
  binderName: string | null;
  binderColor: string | null;
}

type ViewMode = 'grid' | 'list' | 'compact';

const COLLECTION_VIEW_KEY = 'mtg-collection-view-mode';

function readStoredCollectionView(): ViewMode {
  try {
    const v = localStorage.getItem(COLLECTION_VIEW_KEY);
    if (v === 'grid' || v === 'list' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  return 'list';
}
type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'cmc';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

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

export function CardListTable({
  cards,
  binders,
  setMap,
  hideBinderFilter = false,
  onOpenStats,
}: Props) {
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
        };
      });
    }
    // Default: roll duplicate copies of the same printing into one row.
    // The row inherits the binder of the first copy seen — if multiple
    // copies route to different binders, the badge reflects whichever copy
    // we display as the representative.
    const grouped = new Map<string, Row>();
    for (const card of cards) {
      const key = `${card.scryfallId}:${card.finish ?? (card.foil ? 'foil' : 'nonfoil')}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.qty += 1;
      } else {
        const assignment = cardToBinder.get(card.copyId) ?? null;
        grouped.set(key, {
          key,
          card,
          qty: 1,
          binderId: assignment?.id ?? null,
          binderName: assignment?.name ?? null,
          binderColor: assignment?.color ?? null,
        });
      }
    }
    return [...grouped.values()];
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

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + pageSize);

  // Reset to page 1 whenever filters / sort / view / page size change the result set boundaries.
  const [prevFilters, setPrevFilters] = useState({
    debouncedSearch,
    binderExpr,
    colorFilter,
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    setFilter,
    sortKey,
    sortDir,
    view,
    pageSize,
  });
  if (
    prevFilters.debouncedSearch !== debouncedSearch ||
    prevFilters.binderExpr !== binderExpr ||
    prevFilters.colorFilter !== colorFilter ||
    prevFilters.supertypeExpr !== supertypeExpr ||
    prevFilters.typesExpr !== typesExpr ||
    prevFilters.subtypeExpr !== subtypeExpr ||
    prevFilters.rarityExpr !== rarityExpr ||
    prevFilters.setFilter !== setFilter ||
    prevFilters.sortKey !== sortKey ||
    prevFilters.sortDir !== sortDir ||
    prevFilters.view !== view ||
    prevFilters.pageSize !== pageSize
  ) {
    setPrevFilters({
      debouncedSearch,
      binderExpr,
      colorFilter,
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      rarityExpr,
      setFilter,
      sortKey,
      sortDir,
      view,
      pageSize,
    });
    setPage(1);
  }

  const totalRowCount = rows.length;
  const totalValue = sorted.reduce((s, r) => s + r.card.purchasePrice * r.qty, 0);

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
  const allocationsFor = (c: EnrichedCard): AllocationInfo[] => {
    if (!groupPrintings) {
      const a = allocations.get(c.copyId);
      return a ? [a] : [];
    }
    const out: AllocationInfo[] = [];
    for (const x of allCards) {
      if (x.scryfallId !== c.scryfallId || x.foil !== c.foil) continue;
      const a = allocations.get(x.copyId);
      if (a) out.push(a);
    }
    return out;
  };

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

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

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

      {/* Secondary toolbar row — totals + Stats. Scrolls away with the
          list so the sticky search above stays minimal. */}
      <div className="collection-toolbar-meta">
        <div className="collection-toolbar-totals" aria-label="Collection totals">
          <span className="collection-toolbar-totals-num">
            {collectionCardCount.toLocaleString()}
          </span>
          <span className="collection-toolbar-totals-unit">cards</span>
          <span className="collection-toolbar-totals-sep">·</span>
          <span className="collection-toolbar-totals-num">${collectionValue.toFixed(0)}</span>
        </div>
        {onOpenStats && (
          <button
            type="button"
            className="collection-toolbar-stats-btn"
            onClick={onOpenStats}
            aria-label="Open collection breakdown"
            title="Breakdown"
          >
            <BarChart3 width={14} height={14} strokeWidth={2} aria-hidden />
            <span className="collection-toolbar-stats-label">Stats</span>
          </button>
        )}
      </div>

      <div className="card-list-summary-line">
        {/* Counts here describe what's currently visible (after filters /
            search), not the whole collection — the sticky toolbar above
            owns the canonical totals. Announced to AT so screen readers
            stay in sync with visual filtering. */}
        <span aria-live="polite" aria-atomic="true">
          {sorted.length === totalRowCount
            ? `${sorted.length.toLocaleString()} ${sorted.length === 1 ? 'printing' : 'printings'}`
            : `${sorted.length.toLocaleString()} of ${totalRowCount.toLocaleString()} printings`}
          {' · '}${totalValue.toFixed(0)}
        </span>
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
          sectionLabels={sorted.map((r) => r.binderName ?? 'Uncategorized')}
          pageNumbers={sorted.map(() => 0)}
          totalPages={0}
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
        <div className="collection-grid">
          {pageItems.map((r, i) => (
            <button
              key={r.key}
              type="button"
              className="collection-grid-item"
              onClick={() => setPreviewIndex(pageStart + i)}
              aria-label={`${r.card.name}, quantity ${r.qty}`}
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
              {r.qty > 1 && <span className="collection-grid-qty">x{r.qty}</span>}
              {r.card.foil && <span className="collection-grid-foil">foil</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className={`collection-list${view === 'compact' ? ' is-compact' : ''}`}>
          {pageItems.map((r, i) => {
            const colorKey = getColorKey(r.card);
            return (
              <div
                key={r.key}
                className="collection-list-row"
                role="row"
                tabIndex={0}
                onClick={() => setPreviewIndex(pageStart + i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPreviewIndex(pageStart + i);
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
                    <BinderBadge
                      binderId={r.binderId}
                      binderName={r.binderName}
                      binderColor={r.binderColor}
                    />
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
            );
          })}
        </div>
      )}

      {sorted.length > PAGE_SIZE_OPTIONS[0] && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          pageSize={pageSize}
          onChange={setPage}
          onPageSizeChange={setPageSize}
        />
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

interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: PageSize;
  onChange: (p: number) => void;
  onPageSizeChange: (s: PageSize) => void;
}

function Pagination({ page, totalPages, pageSize, onChange, onPageSizeChange }: PaginationProps) {
  const pages = pageRange(page, totalPages);
  return (
    <nav className="pagination" aria-label="Pagination">
      <div className="pagination-meta">
        <div className="pagination-pagesize">
          <SelectMenu
            label="Per page"
            ariaLabel="Cards per page"
            value={pageSize}
            onChange={(v) => onPageSizeChange(v as PageSize)}
            options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
        <span className="pagination-status">
          Page {page} of {totalPages}
        </span>
      </div>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`g${i}`} className="pagination-ellipsis" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pagination-btn${p === page ? ' is-active' : ''}`}
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="pagination-btn"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </nav>
  );
}

/**
 * Compact page list with ellipses.
 *   total=68, page=1  → [1, 2, 3, …, 68]
 *   total=68, page=34 → [1, …, 33, 34, 35, …, 68]
 *   total=68, page=68 → [1, …, 66, 67, 68]
 */
function pageRange(page: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}
