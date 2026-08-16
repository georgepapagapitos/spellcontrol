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
import { SharedEmptyState } from './SharedEmptyState';
import { CardPreview } from '../CardPreview';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { useSharedFilters } from './use-shared-filters';
import { SearchPill } from '../SearchPill';
import { SortMenu, type SortMenuOption } from '../SortMenu';
import { ViewModeToggle } from '../ViewModeToggle';
import { formatMoney } from '../../lib/format-money';
import { formatIdentity } from '../../lib/display-name';

interface Props {
  data: PublicCollection;
}

type ViewKind = 'grid' | 'list';

// Public read-only page — it can't import the collection's sort machinery
// (its keys are this projection's own), so the direction wording is authored
// here to match the private surfaces word for word.
const SORT_OPTIONS: SortMenuOption<SharedSortKey>[] = [
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cmc', label: 'Mana value', dirLabels: ['Low → high', 'High → low'] },
  { value: 'price', label: 'Price', dirLabels: ['Cheapest', 'Priciest'] },
  { value: 'set', label: 'Set', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'rarity', label: 'Rarity', dirLabels: ['Common first', 'Mythic first'] },
  { value: 'qty', label: 'Quantity', dirLabels: ['Fewest', 'Most'] },
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

  // Mirrors the collection's sort behavior: re-picking the active field flips
  // direction (which is what SortMenu's Reverse action calls), picking a new
  // field resets to ascending.
  const toggleSort = (key: SharedSortKey) => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  };

  const owner = formatIdentity({
    username: data.ownerUsername,
    displayName: data.ownerDisplayName,
  });

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">
          Shared by {owner.primary}
          {owner.secondary && <span className="shared-view-owner-handle">{owner.secondary}</span>}
        </p>
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
        <SortMenu<SharedSortKey>
          ariaLabel="Sort"
          value={sort}
          dir={dir}
          options={SORT_OPTIONS}
          onChange={toggleSort}
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
        <SharedEmptyState
          empty={totalCards === 0}
          emptyTagline="This collection is empty."
          emptyHint="The owner hasn't added any cards to it yet."
          filteredTagline="No cards match your search or filters."
          onClearSearch={search ? () => setSearch('') : undefined}
        />
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
