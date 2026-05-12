import { useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { UploadPanel } from '../components/UploadPanel';
import { ImportSheet } from '../components/ImportSheet';
import { AddCardSheet } from '../components/AddCardSheet';
import { StatsBar } from '../components/StatsBar';
import { CardListTable } from '../components/CardListTable';

export function CollectionPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);
  const setImportSheetOpen = useCollectionStore((s) => s.setImportSheetOpen);
  const [addCardOpen, setAddCardOpen] = useState(false);

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, { search: '' });
    return { materialized: result.binders };
  }, [cards, binders]);

  return (
    <>
      {hydrating ? (
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="visually-hidden">Loading</span>
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
          {cards.length === 0 && <UploadPanel />}
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <header className="binder-hero collection-hero">
            <div className="collection-hero-text">
              <h1 className="binder-hero-name">Collection</h1>
            </div>
            <div className="collection-hero-actions">
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setAddCardOpen(true)}
              >
                <PlusIcon />
                <span>Add card</span>
              </button>
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setImportSheetOpen(true)}
              >
                <ImportIcon />
                <span>Import cards</span>
              </button>
            </div>
          </header>
          <StatsBar />
          <CardListTable cards={cards} binders={materialized} />
          <ImportSheet />
          {addCardOpen && <AddCardSheet onClose={() => setAddCardOpen(false)} />}
        </>
      )}
    </>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v8M5 7l3 3 3-3" />
      <path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}
