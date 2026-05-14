import { Download, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useAllocations } from '../lib/allocations';
import { useSetMap } from '../lib/api';
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

  const [statsOpen, setStatsOpen] = useState(false);

  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  const setMap = useSetMap();

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
    });
    return { materialized: result.binders };
  }, [cards, binders, allocatedCopyIds, setMap]);

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
                <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Add card</span>
              </button>
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setImportSheetOpen(true)}
              >
                <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Import cards</span>
              </button>
            </div>
          </header>
          <CardListTable
            cards={cards}
            binders={materialized}
            setMap={setMap}
            onOpenStats={() => setStatsOpen(true)}
          />
          <StatsBar open={statsOpen} onClose={() => setStatsOpen(false)} />
          <ImportSheet />
          {addCardOpen && <AddCardSheet onClose={() => setAddCardOpen(false)} />}
        </>
      )}
    </>
  );
}
