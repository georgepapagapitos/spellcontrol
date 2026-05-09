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
  const setImportSheetOpen = useCollectionStore((s) => s.setImportSheetOpen);

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, { search: '' });
    return { materialized: result.binders };
  }, [cards, binders]);

  const totalValue = useMemo(() => cards.reduce((sum, c) => sum + c.purchasePrice, 0), [cards]);
  const uniquePrintings = useMemo(() => {
    const seen = new Set<string>();
    for (const c of cards) seen.add(c.scryfallId);
    return seen.size;
  }, [cards]);

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
          {cards.length === 0 && <UploadPanel />}
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <header className="binder-hero collection-hero">
            <div className="collection-hero-text">
              <h1 className="binder-hero-name">Collection</h1>
              <p className="binder-hero-meta">
                {cards.length.toLocaleString()} {cards.length === 1 ? 'card' : 'cards'} ·{' '}
                {uniquePrintings.toLocaleString()} unique · ${totalValue.toFixed(0)}
              </p>
            </div>
            <button
              type="button"
              className="pill-btn collection-hero-action"
              aria-haspopup="dialog"
              onClick={() => setImportSheetOpen(true)}
            >
              <PlusIcon />
              <span>Import cards</span>
            </button>
          </header>
          <StatsBar />
          <CardListTable cards={cards} binders={materialized} />
          <PriceFreshnessLine />
          <ImportSheet />
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
