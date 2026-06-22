import { useMemo, useState } from 'react';
import type { PublicCard, PublicCollection } from '../../lib/shared-types';
import {
  applySharedFilters,
  availableRarities,
  availableSets,
  availableTypes,
  emptySharedFilters,
  filterBySearch,
  groupCards,
  sortGrouped,
  type SharedFilters,
  type SharedSortKey,
  type SortDir,
} from '../../lib/shared-grouping';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { SharedCardModal } from './SharedCardModal';
import { SharedFilterPopover } from './SharedFilterPopover';
import { SearchPill } from '../SearchPill';
import { SelectMenu } from '../SelectMenu';
import { SortDirArrow } from '../SortDirArrow';
import { ViewModeToggle } from '../ViewModeToggle';
import { formatMoney } from '../../lib/format-money';

interface Props {
  data: PublicCollection;
}

type ViewKind = 'grid' | 'list';

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
  const [filters, setFilters] = useState<SharedFilters>(emptySharedFilters);
  const [view, setView] = useState<ViewKind>('grid');
  const [preview, setPreview] = useState<PublicCard | null>(null);

  const grouped = useMemo(() => groupCards(data.cards), [data.cards]);

  // Facet options come from the data present, so the popover only offers
  // rarities/types/sets that actually exist in this collection.
  const rarityOptions = useMemo(() => availableRarities(data.cards), [data.cards]);
  const typeOptions = useMemo(() => availableTypes(data.cards), [data.cards]);
  const setOptions = useMemo(() => availableSets(data.cards), [data.cards]);

  const filtered = useMemo(
    () => applySharedFilters(filterBySearch(grouped, search), filters),
    [grouped, search, filters]
  );

  const sorted = useMemo(() => sortGrouped(filtered, sort, dir), [filtered, sort, dir]);

  const totalCards = data.cards.length;
  const totalValue = data.cards.reduce((sum, c) => sum + c.purchasePrice, 0);

  // Mirrors the collection's SelectMenu sort behavior: re-picking the active
  // field flips direction, picking a new field resets to ascending.
  const toggleSort = (key: SharedSortKey) => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  };

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">Collection</h1>
        <p className="shared-view-subtitle">
          {totalCards.toLocaleString()} {totalCards === 1 ? 'card' : 'cards'} ·{' '}
          {formatMoney(totalValue, { wholeDollars: true })}
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
          trailing={
            <SharedFilterPopover
              filters={filters}
              setFilters={setFilters}
              rarities={rarityOptions}
              types={typeOptions}
              sets={setOptions}
            />
          }
        />
        <SelectMenu<SharedSortKey>
          ariaLabel="Sort"
          value={sort}
          options={SORT_OPTIONS.map((s) => ({ value: s.key, label: s.label }))}
          onChange={toggleSort}
          closeOnSelect={false}
          leadingIcon={<SortDirArrow dir={dir} />}
          renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={dir} /> : null)}
        />
        <ViewModeToggle<ViewKind>
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
              label: 'List view',
              icon: <ListIcon width={14} height={14} strokeWidth={2} aria-hidden />,
            },
          ]}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="shared-empty">
          {totalCards === 0 ? 'This collection is empty.' : 'No cards match your filters.'}
        </p>
      ) : view === 'grid' ? (
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
      ) : (
        <SharedCardList items={sorted} onPreview={setPreview} />
      )}

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
