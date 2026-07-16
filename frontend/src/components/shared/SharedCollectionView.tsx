import { useMemo, useState } from 'react';
import type { PublicCollection } from '../../lib/shared-types';
import {
  filterBySearch,
  groupCards,
  sortGrouped,
  type SharedSortKey,
  type SortDir,
} from '../../lib/shared-grouping';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { CardPreview } from '../CardPreview';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { useSharedFilters } from './use-shared-filters';
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
  { key: 'cmc', label: 'Mana value' },
  { key: 'price', label: 'Price' },
  { key: 'set', label: 'Set' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'qty', label: 'Quantity' },
];

export function SharedCollectionView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SharedSortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const [view, setView] = useState<ViewKind>('grid');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const grouped = useMemo(() => groupCards(data.cards), [data.cards]);

  const { filterNode, matches } = useSharedFilters(data.cards);

  const filtered = useMemo(
    () => filterBySearch(grouped, search).filter((g) => matches(g.card)),
    [grouped, search, matches]
  );

  const sorted = useMemo(() => sortGrouped(filtered, sort, dir), [filtered, sort, dir]);

  // Flat card list for the shared carousel — parallel to `sorted`, so a tile's
  // index is its carousel index. Rebuilds only when the sorted result changes.
  const previewCards = useMemo(() => sorted.map((g) => publicCardToEnriched(g.card)), [sorted]);
  const previewLabels = useMemo(() => sorted.map(() => ''), [sorted]);
  const previewPages = useMemo(() => sorted.map(() => 0), [sorted]);

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
          {/* Shared projections are server-stamped USD — pin the symbol. */}
          {formatMoney(totalValue, { wholeDollars: true, currency: 'USD' })}
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
          trailing={filterNode}
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
          {sorted.map((g, i) => (
            <li key={g.key}>
              <SharedCardTile
                card={g.card}
                quantity={g.quantity}
                onClick={() => setPreviewIndex(i)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <SharedCardList items={sorted} onPreview={setPreviewIndex} />
      )}

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Collection"
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={0}
          getStackQty={(i) => sorted[i]?.quantity ?? 1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </main>
  );
}
