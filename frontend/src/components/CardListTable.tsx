import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EnrichedCard, MaterializedBinder } from '../types';
import { CardPreview } from './CardPreview';
import { useDebouncedValue } from '../lib/use-debounced-value';

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

type SortKey = 'name' | 'set' | 'rarity' | 'price' | 'qty' | 'binder';

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  bonus: 5,
};

const ROW_HEIGHT = 44;

export function CardListTable({ cards, binders }: Props) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [binderFilter, setBinderFilter] = useState<string>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // scryfallId+foil -> binder assignment. First-match wins, mirroring materialize.
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

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.card.name.toLowerCase().includes(q) && !r.card.setCode.toLowerCase().includes(q))
        return false;
      if (binderFilter === 'all') return true;
      if (binderFilter === '__uncategorized') return r.binderName === null;
      return r.binderName === binderFilter;
    });
  }, [rows, debouncedSearch, binderFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
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
        case 'binder':
          cmp = (a.binderName ?? 'zzz').localeCompare(b.binderName ?? 'zzz');
          break;
      }
      if (cmp === 0) cmp = a.card.name.localeCompare(b.card.name);
      return cmp * dir;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'price' || key === 'qty' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const totalQty = sorted.reduce((s, r) => s + r.qty, 0);
  const totalValue = sorted.reduce((s, r) => s + r.card.purchasePrice * r.qty, 0);

  return (
    <div className="card-list">
      <div className="card-list-toolbar">
        <div className="card-list-search">
          <input
            type="search"
            placeholder="Search cards by name or set..."
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
        <select
          className="card-list-binder-filter"
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
        <div className="card-list-summary">
          {sorted.length.toLocaleString()} {sorted.length === 1 ? 'card' : 'cards'} ·{' '}
          {totalQty.toLocaleString()} total · ${totalValue.toFixed(0)}
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
        />
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">No cards match your filters.</div>
      ) : (
        <div className="card-list-grid">
          <div className="card-list-grid-header" role="row">
            <button className="card-list-sort" onClick={() => handleSort('name')}>
              Name{sortIndicator('name')}
            </button>
            <button className="card-list-sort" onClick={() => handleSort('set')}>
              Set{sortIndicator('set')}
            </button>
            <button className="card-list-sort" onClick={() => handleSort('rarity')}>
              Rarity{sortIndicator('rarity')}
            </button>
            <button className="card-list-sort num" onClick={() => handleSort('qty')}>
              Qty{sortIndicator('qty')}
            </button>
            <button className="card-list-sort num" onClick={() => handleSort('price')}>
              Price{sortIndicator('price')}
            </button>
            <button className="card-list-sort" onClick={() => handleSort('binder')}>
              Binder{sortIndicator('binder')}
            </button>
          </div>
          <div className="card-list-scroll" ref={scrollRef}>
            <div className="card-list-virtual" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const r = sorted[virtualRow.index];
                return (
                  <div
                    key={r.key}
                    className="card-list-grid-row"
                    role="row"
                    tabIndex={0}
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => setPreviewIndex(virtualRow.index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPreviewIndex(virtualRow.index);
                      }
                    }}
                  >
                    <div>
                      <span className="card-list-name">{r.card.name}</span>
                      {r.card.foil && <span className="card-list-foil-tag">foil</span>}
                    </div>
                    <div className="card-list-set">
                      <span className="card-list-set-code">{r.card.setCode.toUpperCase()}</span>
                      <span className="card-list-cn">#{r.card.collectorNumber}</span>
                    </div>
                    <div>
                      <span className={`card-list-rarity rarity-${r.card.rarity}`}>
                        {r.card.rarity}
                      </span>
                    </div>
                    <div className="num">{r.qty}</div>
                    <div className="num">${(r.card.purchasePrice * r.qty).toFixed(2)}</div>
                    <div>
                      {r.binderName ? (
                        <span
                          className="card-list-binder-chip"
                          style={{ background: r.binderColor ?? undefined }}
                        >
                          {r.binderName}
                        </span>
                      ) : (
                        <span className="card-list-binder-none">Uncategorized</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
