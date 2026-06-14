import { BarChart3, Plus, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAnimatedNumber } from '../lib/use-animated-number';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { getSyncState, onSyncedChange } from '../lib/sync';
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
  const authStatus = useAuth((s) => s.status);
  const [searchParams, setSearchParams] = useSearchParams();

  // Re-render on sync-state transitions. On a fresh device the local cache is
  // empty, so `hydrating` flips false with zero cards and the collection only
  // streams in afterwards via the initial server pull — without this the page
  // would flash its empty-state ("Add cards") before the cards arrive. We
  // subscribe so the syncing→ready transition (and an empty account settling)
  // re-evaluates the loading branch below.
  const [, forceSyncTick] = useState(0);
  useEffect(() => onSyncedChange(() => forceSyncTick((n) => n + 1)), []);

  // Deep-link: ?add=list opens the AddCardsSheet on the "Add from list" tab.
  // Both the open-flag and the initial tab are captured at mount via the lazy
  // useState initialiser so they remain stable even after the param is stripped
  // from the URL (which triggers a re-render with an empty searchParams).
  // Only 'list' is supported; unknown ?add= values open the sheet on 'search'.
  const [addCardsOpen, setAddCardsOpen] = useState(() => searchParams.get('add') !== null);
  const [initialTab] = useState<'upload' | 'search'>(() =>
    searchParams.get('add') === 'list' ? 'upload' : 'search'
  );

  useEffect(() => {
    if (searchParams.get('add') !== null) {
      // Strip the param from the URL without adding a history entry so a
      // refresh doesn't re-open the sheet.
      const next = new URLSearchParams(searchParams);
      next.delete('add');
      setSearchParams(next, { replace: true });
    }
    // Run only once on mount — the param value is already captured in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [shareOpen, setShareOpen] = useState(false);

  const [statsOpen, setStatsOpen] = useState(false);

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

  // Reveal animations for the hero stats. Card count counts up on first load;
  // dollar value reveals (integer only, no pop animation wired up — popKey is
  // intentionally unused here per §8.1 of the UX-411 spec).
  const { display: displayCardCount } = useAnimatedNumber(collectionCardCount, {
    revealMs: 600,
    revealKey: 'collection-hero-count',
  });
  const { display: displayValue } = useAnimatedNumber(Math.floor(collectionValue), {
    revealMs: 600,
    revealKey: 'collection-hero-value',
  });

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

  // Show a loading state — not the empty "Add cards" view — while an authed
  // device is still pulling its collection from the server (the fresh-device
  // window where local hydrate found nothing). As soon as the first row lands,
  // `isEmpty` flips false and the real collection renders; a genuinely empty
  // account falls through to the empty state once sync settles to 'ready'.
  const loadingCollection =
    hydrating || (isEmpty && authStatus === 'authed' && getSyncState() === 'syncing');

  return (
    <>
      {loadingCollection ? (
        <div className="page-loader page-loader--message" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="page-loader-message">Loading your collection…</span>
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
                  {displayCardCount.toLocaleString()} {collectionCardCount === 1 ? 'card' : 'cards'}{' '}
                  ·{' '}
                  <span title="Current market value (Scryfall)">
                    {formatMoney(displayValue, { wholeDollars: true })}
                  </span>
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

      {addCardsOpen && (
        <AddCardsSheet initialTab={initialTab} onClose={() => setAddCardsOpen(false)} />
      )}
    </>
  );
}
