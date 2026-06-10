import { BarChart3, Plus, Share2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useAllocations } from '../lib/allocations';
import { useSetMap } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { AddCardsSheet } from '../components/AddCardsSheet';
import { StatsBar } from '../components/StatsBar';
import { CardListTable } from '../components/CardListTable';
import { ShareDialog } from '../components/ShareDialog';

export function CollectionPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);
  const [addCardsOpen, setAddCardsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const [statsOpen, setStatsOpen] = useState(false);

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

  // Newest price stamp across the collection — the "Prices as of" honesty
  // line. Derived once per cards-array identity, not per render.
  const pricesAsOf = useMemo(() => {
    let newest = 0;
    for (const c of cards) {
      if (c.pricedAt != null && c.pricedAt > newest) newest = c.pricedAt;
    }
    return newest > 0 ? newest : null;
  }, [cards]);

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

  const isEmpty = collectionCardCount === 0;

  return (
    <>
      {hydrating ? (
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="visually-hidden">Loading</span>
        </div>
      ) : (
        <>
          {error && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              {error}
              <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {/* The collection view is the same whether or not it has cards: hero,
              search, and the grid/list always render. An empty collection just
              shows an empty-state body (with its own Add cards CTA) instead of
              a separate import screen — adding/importing happens through the
              always-present "Add cards" sheet (search · list · scan). Stats and
              Share hide when there's nothing yet to break down or share. */}
          <header className="binder-hero collection-hero">
            <div className="collection-hero-text">
              <h1 className="binder-hero-name">Collection</h1>
              <p className="binder-hero-meta collection-hero-meta">
                <span aria-label="Collection totals">
                  {collectionCardCount.toLocaleString()}{' '}
                  {collectionCardCount === 1 ? 'card' : 'cards'} ·{' '}
                  {formatMoney(collectionValue, { wholeDollars: true })}
                </span>
                {!isEmpty && (
                  <>
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
                  </>
                )}
              </p>
              {pricesAsOf != null && (
                <p className="binder-hero-meta collection-hero-priced-at">
                  Prices as of{' '}
                  {new Date(pricesAsOf).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              )}
            </div>
            <div className="collection-hero-actions">
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setAddCardsOpen(true)}
              >
                <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Add cards</span>
              </button>
              {!isEmpty && (
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
          <CardListTable
            cards={cards}
            binders={materialized}
            setMap={setMap}
            onAddCards={() => setAddCardsOpen(true)}
          />
          <StatsBar open={statsOpen} onClose={() => setStatsOpen(false)} />
          {shareOpen && (
            <ShareDialog
              kind="collection"
              resourceLabel="your collection"
              onClose={() => setShareOpen(false)}
            />
          )}
        </>
      )}

      {addCardsOpen && <AddCardsSheet onClose={() => setAddCardsOpen(false)} />}
    </>
  );
}
