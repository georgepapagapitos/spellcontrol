import { useEffect, useMemo, useState } from 'react';
import type { EnrichedCard, MaterializedBinder } from '../types';
import { CardPreview } from './CardPreview';
import { ManaCost } from './ManaCost';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { RARITY_ORDER } from '../lib/sorting';
import { getCardType, TYPE_ORDER } from '../lib/card-types';
import { getColorKey, COLOR_INFO } from '../lib/colors';

interface Props {
  cards: EnrichedCard[];
  binders: MaterializedBinder[];
}

interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  binderName: string | null;
  binderColor: string | null;
}

type ViewMode = 'grid' | 'list';
type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'cmc';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const TYPE_LABELS: Record<string, string> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  land: 'Land',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
  other: 'Other',
};

const COLOR_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

const SORT_OPTIONS: Array<{ value: `${SortKey}:${'asc' | 'desc'}`; label: string }> = [
  { value: 'name:asc', label: 'Name A → Z' },
  { value: 'name:desc', label: 'Name Z → A' },
  { value: 'cmc:asc', label: 'CMC low → high' },
  { value: 'cmc:desc', label: 'CMC high → low' },
  { value: 'price:desc', label: 'Price high → low' },
  { value: 'price:asc', label: 'Price low → high' },
  { value: 'qty:desc', label: 'Quantity high → low' },
  { value: 'rarity:asc', label: 'Rarity (mythic first)' },
  { value: 'set:asc', label: 'Set' },
];

export function CardListTable({ cards, binders }: Props) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [sort, setSort] = useState<`${SortKey}:${'asc' | 'desc'}`>('name:asc');
  const [view, setView] = useState<ViewMode>('grid');
  const [binderFilter, setBinderFilter] = useState<string>('all');
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  const cardToBinder = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const b of binders) {
      for (const section of b.sections) {
        for (const c of section.cards) {
          const k = c.scryfallId + (c.foil ? ':f' : '');
          if (!map.has(k)) map.set(k, { name: b.def.name, color: b.def.color });
        }
      }
    }
    return map;
  }, [binders]);

  const rows = useMemo<Row[]>(() => {
    const grouped = new Map<string, Row>();
    for (const card of cards) {
      const key = `${card.scryfallId}:${card.foil ? 'f' : 'n'}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.qty += 1;
      } else {
        const assignment = cardToBinder.get(key) ?? null;
        grouped.set(key, {
          key,
          card,
          qty: 1,
          binderName: assignment?.name ?? null,
          binderColor: assignment?.color ?? null,
        });
      }
    }
    return [...grouped.values()];
  }, [cards, cardToBinder]);

  // Type counts (over the current rows, ignoring filters) for the chip row.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const t = getCardType(r.card);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

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
      if (binderFilter === 'all') {
        // pass
      } else if (binderFilter === '__uncategorized') {
        if (r.binderName !== null) return false;
      } else if (r.binderName !== binderFilter) {
        return false;
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
      if (typeFilter !== 'all' && getCardType(r.card) !== typeFilter) return false;
      if (rarityFilter !== 'all' && (r.card.rarity || '').toLowerCase() !== rarityFilter)
        return false;
      return true;
    });
  }, [rows, debouncedSearch, binderFilter, colorFilter, typeFilter, rarityFilter]);

  const sorted = useMemo(() => {
    const [key, dirStr] = sort.split(':') as [SortKey, 'asc' | 'desc'];
    const dir = dirStr === 'asc' ? 1 : -1;
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'name':
          cmp = a.card.name.localeCompare(b.card.name);
          break;
        case 'set':
          cmp = a.card.setCode.localeCompare(b.card.setCode);
          break;
        case 'rarity':
          cmp = (RARITY_ORDER[a.card.rarity] ?? 99) - (RARITY_ORDER[b.card.rarity] ?? 99);
          break;
        case 'price':
          cmp = a.card.purchasePrice - b.card.purchasePrice;
          break;
        case 'qty':
          cmp = a.qty - b.qty;
          break;
        case 'cmc':
          cmp = (a.card.cmc ?? 99) - (b.card.cmc ?? 99);
          break;
      }
      if (cmp === 0) cmp = a.card.name.localeCompare(b.card.name);
      return cmp * dir;
    });
    return out;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + pageSize);

  // Reset to page 1 whenever filters / sort / view / page size change the result set boundaries.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, binderFilter, colorFilter, typeFilter, rarityFilter, sort, view, pageSize]);

  const totalQty = sorted.reduce((s, r) => s + r.qty, 0);
  const totalValue = sorted.reduce((s, r) => s + r.card.purchasePrice * r.qty, 0);

  const toggleColor = (c: string) => {
    setColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const orderedTypes = TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0);

  return (
    <div className="card-list">
      {/* Type chip row — quick filter */}
      <div className="collection-type-chips">
        {orderedTypes.map((t) => {
          const active = typeFilter === t;
          return (
            <button
              key={t}
              type="button"
              className={`collection-type-chip${active ? ' is-active' : ''}`}
              onClick={() => setTypeFilter(active ? 'all' : t)}
            >
              <i className={`ms ms-${typeIcon(t)} chip-type-icon`} aria-hidden />
              <span>
                {TYPE_LABELS[t] ?? t} {typeCounts[t]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + view toggle */}
      <div className="collection-toolbar-row">
        <div className="card-list-search">
          <input
            type="search"
            placeholder="Search by name or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search cards"
          />
          {search && (
            <button type="button" className="btn-link" onClick={() => setSearch('')}>
              Clear
            </button>
          )}
        </div>
        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-toggle-btn${view === 'grid' ? ' is-active' : ''}`}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            className={`view-toggle-btn${view === 'list' ? ' is-active' : ''}`}
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
          >
            <ListIcon />
          </button>
        </div>
      </div>

      {/* Color icons + dropdowns */}
      <div className="collection-filter-row">
        <div className="color-filter-row" role="group" aria-label="Filter by color">
          {COLOR_FILTERS.map((c) => {
            const active = colorFilter.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className={`color-filter-btn${active ? ' is-active' : ''}`}
                onClick={() => toggleColor(c.key)}
                aria-label={c.label}
                aria-pressed={active}
                title={c.label}
              >
                <i
                  className={`ms ms-${c.key.toLowerCase()} ms-cost color-pip-mana color-pip-mana--lg`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
        <select
          className="collection-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
        >
          <option value="all">All Types</option>
          {orderedTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <select
          className="collection-select"
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value)}
          aria-label="Filter by rarity"
        >
          <option value="all">All Rarities</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <select
          className="collection-select"
          value={binderFilter}
          onChange={(e) => setBinderFilter(e.target.value)}
          aria-label="Filter by binder"
        >
          <option value="all">All binders</option>
          {binders.map((b) => (
            <option key={b.def.id} value={b.def.name}>
              {b.def.name}
            </option>
          ))}
          <option value="__uncategorized">Uncategorized</option>
        </select>
        <select
          className="collection-select collection-select-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Sort"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="card-list-summary-line">
        {sorted.length.toLocaleString()} {sorted.length === 1 ? 'card' : 'cards'} ·{' '}
        {totalQty.toLocaleString()} total · ${totalValue.toFixed(0)}
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
        />
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">No cards match your filters.</div>
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
        <div className="collection-list">
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
                  </div>
                  <div className="collection-list-meta">
                    <span className="card-list-set-code">{r.card.setCode.toUpperCase()}</span>
                    <span className="card-list-cn">#{r.card.collectorNumber}</span>
                    <ManaCost cost={r.card.manaCost} />
                  </div>
                </div>
                <div className="collection-list-right">
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
        <label className="pagination-pagesize">
          <span>Per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            aria-label="Cards per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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

/** mana-font icon names for our internal type buckets. */
function typeIcon(t: string): string {
  switch (t) {
    case 'creature':
      return 'creature';
    case 'instant':
      return 'instant';
    case 'sorcery':
      return 'sorcery';
    case 'artifact':
      return 'artifact';
    case 'enchantment':
      return 'enchantment';
    case 'land':
      return 'land';
    case 'planeswalker':
      return 'planeswalker';
    case 'battle':
      return 'battle';
    default:
      return 'multiple';
  }
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
