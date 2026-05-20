import { BarChart3, Download, Plus, Share2 } from 'lucide-react';
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
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../store/auth';

export function CollectionPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);
  const setImportSheetOpen = useCollectionStore((s) => s.setImportSheetOpen);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const user = useAuth((s) => s.user);

  const [statsOpen, setStatsOpen] = useState(false);

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

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
              <p className="binder-hero-meta collection-hero-meta">
                <span aria-label="Collection totals">
                  {collectionCardCount.toLocaleString()}{' '}
                  {collectionCardCount === 1 ? 'card' : 'cards'} · ${collectionValue.toFixed(0)}
                </span>
                <span aria-hidden> · </span>
                <button
                  type="button"
                  className="collection-hero-stats-link"
                  onClick={() => setStatsOpen(true)}
                  aria-label="Open collection breakdown"
                  title="Breakdown"
                >
                  <BarChart3 width={12} height={12} strokeWidth={2} aria-hidden />
                  <span>Stats</span>
                </button>
              </p>
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
              {user && (
                <button
                  type="button"
                  className="pill-btn collection-hero-action"
                  aria-haspopup="dialog"
                  onClick={() => setShareOpen(true)}
                  title="Share a read-only link to this collection"
                >
                  <Share2 width={14} height={14} strokeWidth={1.8} aria-hidden />
                  <span>Share</span>
                </button>
              )}
            </div>
          </header>
          <CardListTable cards={cards} binders={materialized} setMap={setMap} />
          <StatsBar open={statsOpen} onClose={() => setStatsOpen(false)} />
          <ImportSheet />
          {addCardOpen && <AddCardSheet onClose={() => setAddCardOpen(false)} />}
          {shareOpen && (
            <ShareDialog
              kind="collection"
              resourceLabel="your collection"
              onClose={() => setShareOpen(false)}
            />
          )}
        </>
      )}
    </>
  );
}
