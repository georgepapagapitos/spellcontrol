import { useEffect, useMemo } from 'react';
import { useCollectionStore } from './store/collection';
import { materializeBinders } from './lib/materialize';
import { UploadPanel } from './components/UploadPanel';
import { StatsBar } from './components/StatsBar';
import { Legend } from './components/Legend';
import { BinderTabs } from './components/BinderTabs';
import { BinderView } from './components/BinderView';
import { BinderEditor } from './components/BinderEditor';
import { Footer } from './components/Footer';

export default function App() {
  const {
    cards,
    binders,
    hydrating,
    error,
    search,
    activeTab,
    hydrateCards,
    setEditingBinder,
    setError,
    setSearch,
  } = useCollectionStore();

  // Hydrate from IndexedDB once on mount. The store starts with hydrating=true so the UI
  // can hold off on rendering "no cards yet" until we know whether there's a stashed upload.
  useEffect(() => {
    hydrateCards();
    // hydrateCards is stable across renders (Zustand actions are not recreated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Materialize binders + uncategorized bucket whenever cards, defs, or relevant config change
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

  return (
    <div className="container">
      <h1>MTG Binder Planner</h1>
      <div className="subtitle">Try binder layouts before you commit a single sleeve.</div>

      {hydrating ? (
        <div className="upload-card loading" style={{ marginBottom: '1.5rem' }}>
          <div className="upload-icon">
            <span className="spinner" />
          </div>
          <div className="upload-text">Loading...</div>
        </div>
      ) : (
        <>
          {error && cards.length === 0 && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              {error}
              <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          <UploadPanel />
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <StatsBar binders={materialized} uncategorized={uncategorized} />
          <hr />
          <Legend />
          <BinderTabs binders={materialized} uncategorized={uncategorized} />
          {(() => {
            const activeBinder =
              activeTab === 'uncategorized'
                ? null
                : materialized.find((b) => b.def.id === activeTab);
            const totals =
              activeTab === 'uncategorized'
                ? {
                    name: 'Uncategorized',
                    cards: uncategorized.totalCards,
                    pages: uncategorized.totalPages,
                  }
                : activeBinder
                  ? {
                      name: activeBinder.def.name,
                      cards: activeBinder.totalCards,
                      pages: activeBinder.totalPages,
                    }
                  : null;
            if (!totals || totals.cards === 0) return null;
            return (
              <div className="binder-summary" aria-live="polite">
                <span className="binder-summary-name">{totals.name}</span>
                <span className="binder-summary-meta">
                  {totals.cards.toLocaleString()} cards · {totals.pages.toLocaleString()} page
                  {totals.pages !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })()}
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
      )}

      <BinderEditor />
      <Footer />
    </div>
  );
}
