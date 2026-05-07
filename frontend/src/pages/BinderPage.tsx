import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { Legend } from '../components/Legend';
import { BinderTabs } from '../components/BinderTabs';
import { BinderView } from '../components/BinderView';
import { BinderExportDialog } from '../components/BinderExportDialog';

export function BinderPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const search = useCollectionStore((s) => s.search);
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setError = useCollectionStore((s) => s.setError);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const [exportOpen, setExportOpen] = useState(false);

  // Debounce the value materialize() sees so each keystroke doesn't trigger a
  // full filter/sort/group pass over the whole collection. The input itself
  // still reflects live keystrokes via the un-debounced `search`.
  const debouncedSearch = useDebouncedValue(search, 180);

  const materialized = useMemo(() => {
    if (cards.length === 0) return [];
    return materializeBinders(cards, binders, { search: debouncedSearch }).binders;
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
          <p className="empty-state-tagline">Plan your binder before you touch a card.</p>
          <p className="empty-state-hint">
            No cards yet. Drop in a CSV from ManaBox, Moxfield, or Archidekt to get started.
          </p>
          <Link to="/collection" className="btn btn-primary">
            Import your collection
          </Link>
        </div>
      </>
    );
  }

  if (binders.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Build your first binder.</p>
        <p className="empty-state-hint">
          A binder is a set of rules that catches cards from your collection. Make one for each
          deck, format, or theme you want to plan around.
        </p>
        <button className="btn btn-primary" onClick={() => setEditingBinder('new')}>
          Create your first binder
        </button>
      </div>
    );
  }

  return (
    <>
      <Legend />
      <BinderTabs binders={materialized} />
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
        <button
          type="button"
          className="upload-action"
          onClick={() => setExportOpen(true)}
          title="Export this binder, all binders, or the full collection"
        >
          <DownloadIcon />
          <span>Export</span>
        </button>
      </div>
      <BinderView binders={materialized} />
      {exportOpen && (
        <BinderExportDialog
          binders={materialized}
          activeId={activeTab}
          onClose={() => setExportOpen(false)}
        />
      )}
    </>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3v8M8 11l-3-3M8 11l3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
