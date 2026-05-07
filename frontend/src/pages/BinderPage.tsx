import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { Legend } from '../components/Legend';
import { BinderTabs } from '../components/BinderTabs';
import { BinderView } from '../components/BinderView';

export function BinderPage() {
  const { cards, binders, hydrating, error, search, setEditingBinder, setError, setSearch } =
    useCollectionStore();

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
    const result = materializeBinders(cards, binders, { search });
    return { materialized: result.binders, uncategorized: result.uncategorized };
  }, [cards, binders, search]);

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
          No cards loaded yet.{' '}
          <Link to="/collection" className="btn btn-primary" style={{ marginLeft: 8 }}>
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
          No binders yet.{' '}
          <button
            className="btn btn-primary"
            onClick={() => setEditingBinder('new')}
            style={{ marginLeft: 8 }}
          >
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
