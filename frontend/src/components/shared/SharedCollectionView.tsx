import { useMemo, useState } from 'react';
import type { PublicCard, PublicCollection } from '../../lib/shared-types';
import {
  filterByColors,
  filterBySearch,
  groupCards,
  sortGrouped,
  type SharedSortKey,
  type SortDir,
} from '../../lib/shared-grouping';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardModal } from './SharedCardModal';
import { SearchPill } from '../SearchPill';

interface Props {
  data: PublicCollection;
}

const COLOR_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const SORT_OPTIONS: Array<{ key: SharedSortKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'cmc', label: 'CMC' },
  { key: 'price', label: 'Price' },
  { key: 'set', label: 'Set' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'qty', label: 'Quantity' },
];

export function SharedCollectionView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SharedSortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PublicCard | null>(null);

  const grouped = useMemo(() => groupCards(data.cards), [data.cards]);

  const filtered = useMemo(() => {
    const searched = filterBySearch(grouped, search);
    return filterByColors(searched, colors);
  }, [grouped, search, colors]);

  const sorted = useMemo(() => sortGrouped(filtered, sort, dir), [filtered, sort, dir]);

  const totalCards = data.cards.length;
  const totalValue = data.cards.reduce((sum, c) => sum + c.purchasePrice, 0);

  const toggleColor = (key: string) => {
    setColors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">Collection</h1>
        <p className="shared-view-subtitle">
          {totalCards.toLocaleString()} {totalCards === 1 ? 'card' : 'cards'} · $
          {totalValue.toFixed(0)}
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
        />
        <label className="shared-sort-label">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SharedSortKey)}
            aria-label="Sort by"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn shared-sort-dir"
          onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label={`Sort direction: ${dir}ending`}
          title={`Direction: ${dir}ending`}
        >
          {dir === 'asc' ? '↑' : '↓'}
        </button>
        <div className="color-filter-row" role="group" aria-label="Filter by color">
          {COLOR_CHIPS.map((c) => {
            const active = colors.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className={`color-filter-btn${active ? ' is-active' : ''}`}
                onClick={() => toggleColor(c.key)}
                aria-pressed={active}
                aria-label={c.label}
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
      </div>

      {sorted.length === 0 ? (
        <p className="shared-empty">
          {totalCards === 0 ? 'This collection is empty.' : 'No cards match your filters.'}
        </p>
      ) : (
        <ul className="shared-card-grid">
          {sorted.map((g) => (
            <li key={g.key}>
              <SharedCardTile
                card={g.card}
                quantity={g.quantity}
                onClick={() => setPreview(g.card)}
              />
            </li>
          ))}
        </ul>
      )}

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
