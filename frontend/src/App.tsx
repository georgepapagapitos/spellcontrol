import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from './store/collection';
import { materializeBinders } from './lib/materialize';
import { exportBindersToPDF } from './lib/pdf-export';
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
    fileName,
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

  // Materialize binders + unbinned bucket whenever cards, defs, or relevant config change
  const { materialized, unbinned } = useMemo(() => {
    if (cards.length === 0) {
      return {
        materialized: [],
        unbinned: {
          totalCards: 0,
          sections: [],
          totalPages: 0,
          effectivePocketSize: 9 as const,
        },
      };
    }
    const result = materializeBinders(cards, binders, { search });
    return { materialized: result.binders, unbinned: result.unbinned };
  }, [cards, binders, search]);

  const [includeImages, setIncludeImages] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const handleExportPDF = async () => {
    if (cards.length === 0 || exporting) return;
    // Scope export to whichever tab is active — the binder being viewed,
    // or the unbinned bucket. Avoids surprising "exported everything" runs.
    const exportBinders =
      activeTab === 'unbinned' ? [] : materialized.filter((b) => b.def.id === activeTab);
    const exportUnbinned = activeTab === 'unbinned' ? unbinned : null;
    if (exportBinders.length === 0 && (!exportUnbinned || exportUnbinned.totalCards === 0)) {
      return;
    }
    setExporting(true);
    setExportProgress(null);
    try {
      await exportBindersToPDF(exportBinders, exportUnbinned, fileName, {
        includeImages,
        onProgress: (done, total) => setExportProgress({ done, total }),
      });
    } catch (err) {
      console.error(err);
      setError('PDF export failed. Try again, or disable card images.');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  return (
    <div className="container">
      <h1>MTG Binder Planner</h1>
      <div className="subtitle">Plan how your collection lays out across physical binders.</div>

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
            <label
              className="field-checkbox"
              title="Embed card art in each pocket. Slower exports and larger files."
            >
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                disabled={exporting}
              />
              Card images
            </label>
            <button className="btn" onClick={handleExportPDF} disabled={exporting}>
              {exporting
                ? exportProgress
                  ? `Exporting… ${exportProgress.done}/${exportProgress.total}`
                  : 'Exporting…'
                : 'Export PDF'}
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
