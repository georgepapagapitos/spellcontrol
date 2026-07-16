import { useMemo, useState } from 'react';
import { LayoutList, AlignJustify, LayoutGrid, Search } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type {
  BinderFilter,
  ChipExpression,
  Finish,
  ListDef,
  ListEntry,
  ScryfallQueryRule,
  SortDir,
  SortField,
} from '../types';
import type { SortContext } from '../lib/sorting';
import { compileFilter, cardMatchesCompiled, isExpressionEmpty } from '../lib/rules';
import { sortCards, printingKey } from '../lib/sorting';
import { getColorKey } from '../lib/colors';
import { cardTagLabel } from '../lib/card-tags';
import { useCardsWithTags } from '../lib/card-tags';
import type { EnrichedListRow } from '../lib/use-enriched-list-entries';
import { ownedCountForEntry } from '../lib/lists';
import { useCollectionStore } from '../store/collection';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { ViewModeToggle } from './ViewModeToggle';
import { Legend } from './Legend';
import { SortDirArrow } from './SortDirArrow';
import { CardRow } from './shared/CardRow';
import { CardPreview } from './CardPreview';
import { OverflowMenu } from './OverflowMenu';
import { InlineCardSearch } from './InlineCardSearch';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { useCardThumb } from '../lib/card-thumbs';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';
import { VerdictBadge } from './deck/VerdictBadge';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

const COLOR_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

// Card-attribute sorts only — lists have no import/edit timestamps, so the
// collection's "Date added"/"Last edited" sorts don't apply here.
const LIST_SORTS: Array<{ value: SortField; label: string; defaultDir: SortDir }> = [
  { value: 'name', label: 'Name', defaultDir: 'asc' },
  { value: 'color', label: 'Color', defaultDir: 'asc' },
  { value: 'type', label: 'Type', defaultDir: 'asc' },
  { value: 'cmc', label: 'Mana value', defaultDir: 'asc' },
  { value: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { value: 'price', label: 'Price', defaultDir: 'desc' },
  { value: 'quantity', label: 'Quantity', defaultDir: 'desc' },
  { value: 'setName', label: 'Set', defaultDir: 'asc' },
];
const DEFAULT_DIR = new Map(LIST_SORTS.map((s) => [s.value, s.defaultDir]));

const VIEW_OPTIONS = [
  {
    value: 'list' as const,
    label: 'List view',
    icon: <LayoutList width={15} height={15} aria-hidden />,
  },
  {
    value: 'compact' as const,
    label: 'Compact view',
    icon: <AlignJustify width={15} height={15} aria-hidden />,
  },
  {
    value: 'grid' as const,
    label: 'Grid view',
    icon: <LayoutGrid width={15} height={15} aria-hidden />,
  },
];

function exprLabel(expr: ChipExpression, transform: (v: string) => string = (v) => v): string {
  return expr.chips
    .filter((c) => c.value.trim())
    .map((c) => (c.negate ? `not ${transform(c.value)}` : transform(c.value)))
    .join(', ');
}

interface Props {
  list: ListDef;
  /** Resolved rows + loading, lifted to the caller so the header cost stat
   *  (ListEntriesView) and this table share one `useEnrichedListEntries` call
   *  instead of double-resolving the same names. */
  rows: EnrichedListRow[];
  loading: boolean;
  /** Dynamic (rule-driven) list: rows are owned collection copies, so the
   *  manual affordances (per-row menu, owned badge, Scryfall add) hide. */
  dynamic?: boolean;
}

/** Placeholder rows shown while entries resolve to card data — count mirrors
 *  the list's entry count (capped) so real rows drop in with no layout shift. */
function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="collection-list" role="status" aria-label="Loading this list's cards">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="collection-list-row-skeleton" aria-hidden>
          <div className="collection-list-skeleton-thumb" />
          <div className="collection-list-skeleton-lines">
            <div className="collection-list-skeleton-bar is-name" />
            <div className="collection-list-skeleton-bar is-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder grid cells while entries resolve — aspect-ratio tiles so the
 *  grid doesn't collapse before real cards arrive. */
function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="list-entries-grid" role="status" aria-label="Loading this list's cards">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="list-entries-grid-cell list-entries-grid-cell--skeleton"
          aria-hidden
        />
      ))}
    </div>
  );
}

/** A single card tile in the grid. Uses the CDN-backed `useCardThumb` hook
 *  (never the rate-limited Scryfall API directly). Clicking opens the preview. */
function ListEntryGridCell({
  name,
  imageUrl,
  qty,
  onActivate,
}: {
  name: string;
  /** The row card's own art (exact printing) — the name-keyed thumb is only a
   *  fallback, since it resolves to Scryfall's default printing. */
  imageUrl?: string;
  qty: number;
  onActivate: () => void;
}) {
  const thumb = useCardThumb(imageUrl ? undefined : name, 'normal');
  const url = imageUrl ?? thumb;
  return (
    <div
      role="button"
      tabIndex={0}
      className="list-entries-grid-cell"
      aria-label={`${name}${qty > 1 ? `, quantity ${qty}` : ''}`}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {url ? (
        <img src={url} alt={name} loading="lazy" className="list-entries-grid-img" />
      ) : (
        <div className="list-entries-grid-placeholder">{name}</div>
      )}
      {qty > 1 && (
        <span className="list-entries-grid-qty" aria-hidden>
          <span className="list-entries-grid-qty-x">×</span>
          {qty}
        </span>
      )}
    </div>
  );
}

/**
 * The filterable, sortable card table for a single list — the same filter
 * dialog, sort menu, view toggle, card rows and preview the collection uses,
 * fed by entries resolved to full card data (`useEnrichedListEntries`). Lists
 * are unowned printing references, so the collection-only filters (condition,
 * binder, finish, price, group-printings) are simply not wired and the dialog
 * hides those sections. Per-row actions live in an overflow menu.
 */
export function ListDetailView({ list, rows: enrichedRows, loading, dynamic = false }: Props) {
  const removeListEntry = useCollectionStore((s) => s.removeListEntry);
  const moveListEntryToCollection = useCollectionStore((s) => s.moveListEntryToCollection);
  const updateListEntry = useCollectionStore((s) => s.updateListEntry);
  const addListEntry = useCollectionStore((s) => s.addListEntry);
  const ownedCards = useCollectionStore((s) => s.cards);

  // Add a Scryfall result as a list entry — the retarget the collection's
  // InlineCardSearch (which would call addCard) to lists instead.
  const addToList = (card: ScryfallCard, finish?: Finish) =>
    addListEntry(list.id, scryfallToEnrichedCard(card, finish ?? 'nonfoil'), 1);

  // Filter state — the card-attribute subset that's meaningful for unowned
  // cards. Mirrors the collection filter dialog's controlled props.
  const [search, setSearch] = useState('');
  const [supertypeExpr, setSupertypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [typesExpr, setTypesExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [subtypeExpr, setSubtypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [oracleTagExpr, setOracleTagExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [scryfallQuery, setScryfallQuery] = useState<ScryfallQueryRule | undefined>(undefined);
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [borderExpr, setBorderExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [cmcMin, setCmcMin] = useState<number | undefined>(undefined);
  const [cmcMax, setCmcMax] = useState<number | undefined>(undefined);

  const [sortKey, setSortKey] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [view, setView] = useState<'list' | 'compact' | 'grid'>('list');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<ListEntry | null>(null);
  // Inline "Search Scryfall to add" affordance — same pattern as the
  // collection table: the list search doubles as the add query, and when it
  // doesn't match a card already in the list you can search Scryfall and add.
  const [scryfallOpen, setScryfallOpen] = useState(false);

  // Decorate with oracle tags only when the tag filter is active (lazy — the
  // snapshot isn't loaded otherwise), then re-pair with entries by index.
  const tagActive = !isExpressionEmpty(oracleTagExpr);
  const cardsRaw = useMemo(() => enrichedRows.map((r) => r.card), [enrichedRows]);
  const taggedCards = useCardsWithTags(cardsRaw, tagActive);
  const rows = useMemo(
    () => enrichedRows.map((r, i) => ({ entry: r.entry, card: taggedCards[i] ?? r.card })),
    [enrichedRows, taggedCards]
  );

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
    if (setFilter.size > 0) f.setCodes = [...setFilter].map((s) => s.toUpperCase());
    if (cmcMin !== undefined) f.cmcMin = cmcMin;
    if (cmcMax !== undefined) f.cmcMax = cmcMax;
    const t = search.trim();
    if (t) f.nameContains = t;
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
    setFilter,
    cmcMin,
    cmcMax,
    search,
  ]);

  const filtered = useMemo(
    () =>
      rows.filter(({ card }) => {
        // Color identity (any-of), same semantics as the collection.
        if (colorFilter.size > 0) {
          const k = getColorKey(card);
          const ci = card.colorIdentity || [];
          const matches =
            (k === 'C' && colorFilter.has('C')) ||
            ci.some((c) => colorFilter.has(c)) ||
            (k !== 'C' && colorFilter.has(k));
          if (!matches) return false;
        }
        return cardMatchesCompiled(card, compiledMatchFilter);
      }),
    [rows, colorFilter, compiledMatchFilter]
  );

  const sorted = useMemo(() => {
    // Accumulate per printing+finish — two entries can share a printing (the
    // Scryfall quick-add doesn't dedup), so the quantity sort uses the
    // printing's total rather than whichever entry was seen last.
    const qtyByPrintingKey = new Map<string, number>();
    for (const r of filtered)
      qtyByPrintingKey.set(
        printingKey(r.card),
        (qtyByPrintingKey.get(printingKey(r.card)) ?? 0) + r.entry.quantity
      );
    const ctx: SortContext = { qtyByPrintingKey };
    const sortedCards = sortCards(
      filtered.map((r) => r.card),
      [{ field: sortKey, dir: sortDir }],
      ctx
    );
    const byCopyId = new Map(filtered.map((r) => [r.card.copyId, r]));
    return sortedCards.map((c) => byCopyId.get(c.copyId)!).filter(Boolean);
  }, [filtered, sortKey, sortDir]);

  const previewCards = useMemo(() => sorted.map((r) => r.card), [sorted]);
  const previewSectionLabels = useMemo(() => sorted.map(() => list.name), [sorted, list.name]);
  const previewPageNumbers = useMemo(() => sorted.map(() => 0), [sorted]);

  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];
    if (search.trim())
      chips.push({ id: 'search', label: `"${search.trim()}"`, onClear: () => setSearch('') });
    if (colorFilter.size > 0) {
      const map: Record<string, string> = {
        W: 'White',
        U: 'Blue',
        B: 'Black',
        R: 'Red',
        G: 'Green',
        C: 'Colorless',
      };
      chips.push({
        id: 'color',
        label: `Color: ${[...colorFilter].map((k) => map[k] ?? k).join(', ')}`,
        onClear: () => setColorFilter(new Set()),
      });
    }
    const exprChip = (
      id: string,
      prefix: string,
      expr: ChipExpression,
      clear: () => void,
      transform?: (v: string) => string
    ) => {
      if (!isExpressionEmpty(expr))
        chips.push({ id, label: `${prefix}: ${exprLabel(expr, transform)}`, onClear: clear });
    };
    exprChip('rarity', 'Rarity', rarityExpr, () => setRarityExpr(EMPTY_EXPR));
    exprChip('supertype', 'Supertype', supertypeExpr, () => setSupertypeExpr(EMPTY_EXPR));
    exprChip('type', 'Type', typesExpr, () => setTypesExpr(EMPTY_EXPR));
    exprChip('subtype', 'Subtype', subtypeExpr, () => setSubtypeExpr(EMPTY_EXPR));
    exprChip('oracle', 'Text', oracleExpr, () => setOracleExpr(EMPTY_EXPR));
    exprChip('oracleTag', 'Tags', oracleTagExpr, () => setOracleTagExpr(EMPTY_EXPR), cardTagLabel);
    if (scryfallQuery) {
      chips.push({
        id: 'scryfallQuery',
        label: `Scryfall: ${scryfallQuery.query}`,
        onClear: () => setScryfallQuery(undefined),
      });
    }
    exprChip('legality', 'Legal in', legalityExpr, () => setLegalityExpr(EMPTY_EXPR));
    exprChip('layout', 'Layout', layoutExpr, () => setLayoutExpr(EMPTY_EXPR));
    exprChip('treatment', 'Treatment', treatmentExpr, () => setTreatmentExpr(EMPTY_EXPR));
    exprChip('border', 'Border', borderExpr, () => setBorderExpr(EMPTY_EXPR));
    if (setFilter.size > 0)
      chips.push({
        id: 'set',
        label: `Set: ${[...setFilter].join(', ')}`,
        onClear: () => setSetFilter(new Set()),
      });
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
    setFilter,
    cmcMin,
    cmcMax,
  ]);

  const clearAll = () => {
    setSearch('');
    setSupertypeExpr(EMPTY_EXPR);
    setTypesExpr(EMPTY_EXPR);
    setSubtypeExpr(EMPTY_EXPR);
    setColorFilter(new Set());
    setRarityExpr(EMPTY_EXPR);
    setOracleExpr(EMPTY_EXPR);
    setOracleTagExpr(EMPTY_EXPR);
    setScryfallQuery(undefined);
    setLegalityExpr(EMPTY_EXPR);
    setLayoutExpr(EMPTY_EXPR);
    setTreatmentExpr(EMPTY_EXPR);
    setBorderExpr(EMPTY_EXPR);
    setSetFilter(new Set());
    setCmcMin(undefined);
    setCmcMax(undefined);
  };

  const pickSort = (next: SortField) => {
    if (next === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(next);
      setSortDir(DEFAULT_DIR.get(next) ?? 'asc');
    }
  };

  const handleEditConfirm = (sel: PrintingSelection) => {
    if (!editing) return;
    void updateListEntry(list.id, editing.id, {
      scryfallId: sel.card.id,
      setCode: (sel.card.set || '').toUpperCase(),
      collectorNumber: sel.card.collector_number || '',
      finish: sel.finish,
    });
    setEditing(null);
  };

  // Cross-references the entry against the collection by the same
  // oracleId/name match the header cost stat uses, so the two never disagree.
  const ownedBadge = (entry: ListEntry) => {
    const ownedQty = ownedCountForEntry(entry, ownedCards);
    if (ownedQty === 0) return undefined;
    const fullyCovered = ownedQty >= entry.quantity;
    return (
      <VerdictBadge
        verdict="owned"
        label={fullyCovered ? undefined : `Owned ×${ownedQty}`}
        title={
          entry.quantity > 1 ? `You own ${ownedQty} of the ${entry.quantity} you want` : undefined
        }
      />
    );
  };

  const rowMenu = (entry: ListEntry) => (
    <OverflowMenu
      ariaLabel={`Actions for ${entry.name}`}
      items={[
        {
          label: 'Add one',
          onClick: () =>
            void updateListEntry(list.id, entry.id, { quantity: Math.min(99, entry.quantity + 1) }),
        },
        ...(entry.quantity > 1
          ? [
              {
                label: 'Remove one',
                onClick: () =>
                  void updateListEntry(list.id, entry.id, { quantity: entry.quantity - 1 }),
              },
            ]
          : []),
        { label: 'Edit printing', onClick: () => setEditing(entry) },
        {
          label: 'Move to collection',
          onClick: () => void moveListEntryToCollection(list.id, entry.id),
        },
        {
          label: 'Remove',
          onClick: () => void removeListEntry(list.id, entry.id),
          danger: true,
        },
      ]}
    />
  );

  const activeCount = activeChips.length;

  return (
    <>
      <div className="collection-toolbar-row">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search this list"
          ariaLabel="Search this list"
          trailing={
            <CollectionFiltersDialog
              supertypeExpr={supertypeExpr}
              setSupertypeExpr={setSupertypeExpr}
              typesExpr={typesExpr}
              setTypesExpr={setTypesExpr}
              subtypeExpr={subtypeExpr}
              setSubtypeExpr={setSubtypeExpr}
              subtypeSuggestions={[]}
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
              setFilter={setFilter}
              setSetFilter={setSetFilter}
              cmcMin={cmcMin}
              setCmcMin={setCmcMin}
              cmcMax={cmcMax}
              setCmcMax={setCmcMax}
              activeCount={activeCount}
            />
          }
        />
      </div>

      {activeChips.length > 0 && (
        <div className="collection-filter-chips" role="group" aria-label="Active filters">
          {activeChips.map((chip) => (
            <span key={chip.id} className="collection-filter-chip">
              <span className="collection-filter-chip-label">{chip.label}</span>
              <button
                type="button"
                className="collection-filter-chip-clear"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={chip.onClear}
              >
                ✕
              </button>
            </span>
          ))}
          {activeChips.length > 1 && (
            <button type="button" className="collection-filter-chips-clear-all" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="card-list-summary-line card-list-controls-sticky">
        <div className="card-list-summary-actions">
          {activeCount > 0 && sorted.length < rows.length && (
            <span className="card-list-result-count" aria-live="polite">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} cards
            </span>
          )}
          <SelectMenu<SortField>
            label="Sort"
            value={sortKey}
            options={LIST_SORTS.map((s) => ({ value: s.value, label: s.label }))}
            onChange={pickSort}
            closeOnSelect={false}
            leadingIcon={<SortDirArrow dir={sortDir} />}
            renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
          />
          <ViewModeToggle value={view} onChange={setView} options={VIEW_OPTIONS} />
          {/* Lists reuses CardRow's collection glyph set (TypeIcon, FoilBadge,
              RarityBadge) — mount the Key at the trailing end of the toolbar so
              those glyphs are explained, same as collection/binder surfaces. */}
          <Legend context="collection" variant="pill" align="right" />
        </div>
      </div>

      {loading ? (
        view === 'grid' ? (
          <SkeletonGrid count={Math.min(Math.max(list.entries.length, 6), 18)} />
        ) : (
          <SkeletonRows count={Math.min(Math.max(list.entries.length, 3), 10)} />
        )
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">
            {rows.length > 0
              ? 'No cards match your filters.'
              : dynamic
                ? 'Nothing in your collection matches this list’s rule yet — new imports that match will appear here automatically.'
                : 'No cards in this list yet.'}
          </p>
          {rows.length > 0 && (
            <button type="button" className="btn-link" onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="list-entries-grid" role="region" aria-label={`${list.name} cards`}>
          {sorted.map((r, i) => (
            <ListEntryGridCell
              key={r.card.copyId}
              name={r.card.name}
              imageUrl={r.card.imageNormal}
              qty={r.entry.quantity}
              onActivate={() => setPreviewIndex(i)}
            />
          ))}
        </div>
      ) : (
        <div
          className={`collection-list${view === 'compact' ? ' is-compact' : ''}`}
          role="region"
          aria-label={`${list.name} cards`}
        >
          {sorted.map((r, i) => (
            <CardRow
              key={r.card.copyId}
              card={r.card}
              qty={r.entry.quantity}
              allocations={[]}
              onActivate={() => setPreviewIndex(i)}
              isLastRow={i === sorted.length - 1}
              menu={dynamic ? undefined : rowMenu(r.entry)}
              ownedBadge={dynamic ? undefined : ownedBadge(r.entry)}
            />
          ))}
        </div>
      )}

      {!dynamic &&
        search.trim().length >= 2 &&
        (scryfallOpen ? (
          <InlineCardSearch
            query={search.trim()}
            onClose={() => setScryfallOpen(false)}
            onAdd={addToList}
          />
        ) : (
          <button
            type="button"
            className="collection-list-scryfall collection-list-scryfall--standalone"
            aria-label={`Search Scryfall for ${search.trim()}`}
            onClick={() => setScryfallOpen(true)}
          >
            <span className="collection-list-scryfall-icon">
              <Search width={18} height={18} strokeWidth={1.7} aria-hidden />
            </span>
            <span className="collection-list-scryfall-text">
              <span className="collection-list-scryfall-title">Search Scryfall</span>
              <span className="collection-list-scryfall-sub">for "{search.trim()}"</span>
            </span>
          </button>
        ))}

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName={list.name}
          sectionLabels={previewSectionLabels}
          pageNumbers={previewPageNumbers}
          totalPages={0}
          getStackQty={(i) => sorted[i]?.entry.quantity ?? 1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {editing && (
        <CardEditDialog
          cardName={editing.name}
          currentScryfallId={editing.scryfallId}
          currentFinish={editing.finish}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
