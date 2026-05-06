import { useEffect, useMemo } from 'react';
import { useCollectionStore } from './store/collection';
import { materializeBinders } from './lib/materialize';
import { exportBindersToPDF } from './lib/pdf-export';
import { UploadPanel } from './components/UploadPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { StatsBar } from './components/StatsBar';
import { Legend } from './components/Legend';
import { BinderTabs } from './components/BinderTabs';
import { BinderView } from './components/BinderView';
import { BinderEditor } from './components/BinderEditor';
import { Footer } from './components/Footer';

export default function App() {
  const {
    cards,
    fileName,
    binders,
    hydrating,
    error,
    globalPocketSize,
    search,
    hydrateCards,
    setEditingBinder,
    setError,
  } = useCollectionStore();

  // Hydrate from IndexedDB once on mount. The store starts with hydrating=true so the UI
  // can hold off on rendering "no cards yet" until we know whether there's a stashed upload.
  useEffect(() => {
    hydrateCards();
    // hydrateCards is stable across renders (Zustand actions are not recreated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Materialize binders + unbinned bucket whenever cards, defs, or relevant config change
  const { materialized, unbinned } = useMemo(() => {
    if (cards.length === 0) {
      return {
        materialized: [],
        unbinned: {
          totalCards: 0,
          sections: [],
          totalPages: 0,
          effectivePocketSize: globalPocketSize,
        },
      };
    }
    const result = materializeBinders(cards, binders, {
      globalPocketSize,
      search,
    });
    return { materialized: result.binders, unbinned: result.unbinned };
  }, [cards, binders, globalPocketSize, search]);

  const handleExportPDF = () => {
    if (cards.length === 0) return;
    exportBindersToPDF(materialized, unbinned, fileName);
  };

  return (
    <div className="container">
      <h1>MTG Binder Planner</h1>
      <div className="subtitle">
        ManaBox CSV → custom binders · cards flow top-to-bottom into the first matching binder
      </div>

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
              <button
                className="btn-link"
                style={{ marginLeft: 8 }}
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          <UploadPanel />
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <ConfigPanel />
          <StatsBar binders={materialized} unbinned={unbinned} />
          <hr />
          <Legend />
          <BinderTabs binders={materialized} unbinned={unbinned} />
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn" onClick={handleExportPDF}>
              Export PDF
            </button>
          </div>
          <BinderView binders={materialized} unbinned={unbinned} />
        </>
      )}

      <BinderEditor />
      <Footer />
    </div>
  );
}
