import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { Legend } from '../components/Legend';
import { BinderTabs } from '../components/BinderTabs';
import { BinderView } from '../components/BinderView';

export function BinderPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const search = useCollectionStore((s) => s.search);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setError = useCollectionStore((s) => s.setError);
  const setSearch = useCollectionStore((s) => s.setSearch);

  // Debounce the value materialize() sees so each keystroke doesn't trigger a
  // full filter/sort/group pass over the whole collection. The input itself
  // still reflects live keystrokes via the un-debounced `search`.
  const debouncedSearch = useDebouncedValue(search, 180);

  const { materialized, uncategorized } = useMemo(() => {
    if (cards.length === 0) {
      return {
        materialized: [],
        uncategorized: {
          totalCards: 0,
          sections: [],
          totalPages: 0,
          effectivePocketSize: 9 as const,
          effectiveSorts: [],
        },
      };
    }
    const result = materializeBinders(cards, binders, { search: debouncedSearch });
    return { materialized: result.binders, uncategorized: result.uncategorized };
  }, [cards, binders, debouncedSearch]);

  if (hydrating) {
    return (
      <div className="upload-card loading" style={{ marginBottom: '1.5rem' }}>
        <div className="upload-icon">
          <span className="spinner" />
        </div>
        <div className="upload-text">Loading...</div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <>
        {error && (
          <div className="error-banner" style={{ marginBottom: '1rem' }}>
            {error}
            <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="empty-state">
          <Link to="/collection" className="btn btn-primary">
            Import your collection
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Legend />
      <BinderTabs binders={materialized} uncategorized={uncategorized} />
      {binders.length === 0 && (
        <div className="empty-state">
          <button className="btn btn-primary" onClick={() => setEditingBinder('new')}>
            Create your first binder
          </button>
        </div>
      )}
      <div className="binder-toolbar">
        <div className="binder-toolbar-search">
          <input
            type="search"
            placeholder="Filter cards by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter cards by name"
          />
          {search && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <BinderView binders={materialized} uncategorized={uncategorized} />
    </>
  );
}
