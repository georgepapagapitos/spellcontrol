import { useMemo, useState } from 'react';
import type { PublicCollection } from '../../lib/shared-types';
import {
  filterBySearch,
  groupCards,
  sortGrouped,
  type SharedSortKey,
  type SortDir,
} from '../../lib/shared-grouping';
import { AlignJustify, LayoutGrid, List as ListIcon } from 'lucide-react';
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
import { Button } from '@/components/shared/Button';

interface Props {
  data: PublicCollection;
  /** Inside a page that already has its own heading and wrapper (a profile's
   *  Collection tab): drops the "Shared by" header and the `.shared-view`
   *  shell, and keeps the count and value as a plain summary line. */
  embedded?: boolean;
}

type ViewKind = 'grid' | 'list' | 'compact';

/** Rows rendered before "Show more" — the friend hub's own page size. */
const PAGE_SIZE = 60;

// Public read-only page — it can't import the collection's sort machinery
// (its keys are this projection's own), so the direction wording is authored
// here to match the private surfaces word for word.
const SORT_OPTIONS: SortMenuOption<SharedSortKey>[] = [
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cmc', label: 'Mana value', dirLabels: ['Low → high', 'High → low'] },
  { value: 'price', label: 'Price', dirLabels: ['Cheapest', 'Priciest'] },
  { value: 'set', label: 'Set', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'rarity', label: 'Rarity', dirLabels: ['Mythic first', 'Common first'] },
  { value: 'qty', label: 'Quantity', dirLabels: ['Fewest', 'Most'] },
];

export function SharedCollectionView({ data, embedded = false }: Props) {
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

  // Render a page at a time, exactly as the friend hub's browser does.
  //
  // This view used to render EVERY row at once — 5,811 tiles on the dev
  // account, and a big collection runs to 11k+. That was already slow before
  // these tiles became the app's real `CardGridCell` (measured on that
  // collection: 21.6k DOM nodes and 2.8s to first tile). The richer tile costs
  // ~10 nodes instead of ~4, which took the same page to 60k nodes, 4.1s, and
  // doubled the cost of a scroll — so paging is what makes one shared tile
  // affordable here, not a nice-to-have. The owner's own collection solves
  // this with virtualization; this view is read-only and far simpler, so it
  // borrows the cheaper of the two answers.
  //
  // Paging the RENDERED rows only. `previewCards` still spans the whole sorted
  // list and a tile's index is still its carousel index, so opening the last
  // visible card and swiping onward walks the full collection.
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [lastSorted, setLastSorted] = useState(sorted);
  if (sorted !== lastSorted) {
    setLastSorted(sorted);
    setVisible(PAGE_SIZE);
  }
  const shown = sorted.slice(0, visible);
  const hasMore = sorted.length > visible;

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

  const summary = (
    <p className="shared-view-subtitle">
      {totalCards.toLocaleString()} {totalCards === 1 ? 'card' : 'cards'} ·{' '}
      {/* Shared projections are server-stamped USD — pin the symbol. */}
      {formatMoney(totalValue, { wholeDollars: true, currency: 'USD' })}
    </p>
  );

  return (
    <div className={embedded ? 'shared-collection-embedded' : 'shared-view'}>
      {embedded ? (
        summary
      ) : (
        <header className="shared-view-header">
          <p className="shared-view-owner">
            Shared by {owner.primary}
            {owner.secondary && <span className="shared-view-owner-handle">{owner.secondary}</span>}
          </p>
          <h1 className="shared-view-title">Collection</h1>
          {summary}
        </header>
      )}

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
            {
              value: 'compact',
              label: 'Compact list (text only)',
              icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
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
      ) : (
        <>
          {view === 'grid' ? (
            <ul className="shared-card-grid">
              {shown.map((g, i) => (
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
            <SharedCardList items={shown} onPreview={setPreviewIndex} table={view === 'compact'} />
          )}
          {hasMore && (
            <Button
              onClick={() => setVisible((n) => n + PAGE_SIZE)}
              className="shared-collection-more"
            >
              Show more ({sorted.length - visible} left)
            </Button>
          )}
        </>
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
    </div>
  );
}
