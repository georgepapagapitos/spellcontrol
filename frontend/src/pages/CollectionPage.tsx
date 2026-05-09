import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { UploadPanel } from '../components/UploadPanel';
import { ImportSheet } from '../components/ImportSheet';
import { StatsBar } from '../components/StatsBar';
import { CardListTable } from '../components/CardListTable';
import { PriceFreshnessLine } from '../components/PriceFreshnessLine';

export function CollectionPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, { search: '' });
    return { materialized: result.binders };
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
          {/* Empty state only — once a collection exists, the import UI
              moves into the bottom sheet triggered by the "+" in the
              OVERVIEW row, not the page content. */}
          {cards.length === 0 && <UploadPanel />}
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <StatsBar />
          <CardListTable cards={cards} binders={materialized} />
          <PriceFreshnessLine />
          <ImportSheet />
        </>
      )}
    </>
  );
}
