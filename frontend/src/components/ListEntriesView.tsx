import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ListDef } from '../types';
import { useEnrichedListEntries } from '../lib/use-enriched-list-entries';
import { summarizeListCost } from '../lib/list-cost';
import { formatMoney } from '../lib/format-money';
import { useCollectionStore } from '../store/collection';
import { ListDetailView } from './ListDetailView';
import { ListAddCardSheet } from './ListAddCardSheet';

interface Props {
  list: ListDef;
}

/**
 * Per-list detail page. The card table (`ListDetailView`) reuses the
 * collection's filter dialog, sort, view toggle, rows, preview — and its
 * inline "Search Scryfall to add" affordance (the list search doubles as the
 * add query). An explicit "Add card" button opens that same search-and-add
 * flow in a sheet, so adding works even on an empty list.
 *
 * `useEnrichedListEntries` is called once here (not inside `ListDetailView`)
 * so the header's acquisition-cost stat and the table share one name
 * resolution pass instead of double-fetching the same cards.
 */
export function ListEntriesView({ list }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const { rows, loading } = useEnrichedListEntries(list.entries);
  const ownedCards = useCollectionStore((s) => s.cards);
  const cost = useMemo(() => summarizeListCost(rows, ownedCards), [rows, ownedCards]);

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">{list.name}</h1>
          <p className="binder-hero-meta">
            {list.entries.length.toLocaleString()} {list.entries.length === 1 ? 'card' : 'cards'}
            {list.entries.length > 0 && (
              <>
                {' · '}
                {loading ? (
                  <span className="collection-hero-pricing" aria-live="polite">
                    <span className="sync-indicator-spinner" aria-hidden="true" />
                    Pricing…
                  </span>
                ) : cost.allOwned ? (
                  <span title="Every copy on this list is already in your collection">
                    you already own everything here
                  </span>
                ) : (
                  <span title="Cost to buy everything on this list you don't already own (Scryfall market price)">
                    {formatMoney(cost.totalCost, { wholeDollars: true })} to complete
                    {cost.unpricedCount > 0 &&
                      ` (+${cost.unpricedCount.toLocaleString()} unpriced)`}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="binders-index-actions">
          <Link to="/collection/lists" className="pill-btn">
            <span>Back to lists</span>
          </Link>
          <button
            type="button"
            className="pill-btn pill-btn-primary"
            onClick={() => setAddOpen(true)}
          >
            <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Add card</span>
          </button>
        </div>
      </header>

      <ListDetailView list={list} rows={rows} loading={loading} />

      {addOpen && <ListAddCardSheet list={list} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
