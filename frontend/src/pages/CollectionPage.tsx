import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { UploadPanel } from '../components/UploadPanel';
import { StatsBar } from '../components/StatsBar';
import { CardListTable } from '../components/CardListTable';

export function CollectionPage() {
  const { cards, binders, hydrating, error, setError } = useCollectionStore();

  // Materialize without search — the collection table has its own local search.
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
    const result = materializeBinders(cards, binders, { search: '' });
    return { materialized: result.binders, uncategorized: result.uncategorized };
  }, [cards, binders]);

  return (
    <>
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
          <CardListTable cards={cards} binders={materialized} />
        </>
      )}
    </>
  );
}
