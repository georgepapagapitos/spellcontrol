import './DiscoverDecksPage.css';
import { useCallback, useEffect, useState } from 'react';
import { DecksHubTabs } from '../components/DecksHubTabs';
import {
  DiscoverDeckTile,
  DiscoverTileSkeleton,
  DISCOVER_SKELETON_COUNT,
} from '../components/DiscoverDeckTile';
import { listDiscoverDecks, type DiscoverDeck } from '../lib/discover-client';

/**
 * /decks/discover — newest-first browse of every public deck on the
 * platform. No filters/sort UI yet (`w2-discover-filters-sort` adds those);
 * this PR wires the grid, pagination, and loading/empty/error states.
 * Unauthenticated read — works the same for guests and signed-in users.
 */
export function DiscoverDecksPage() {
  const [decks, setDecks] = useState<DiscoverDeck[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Imperative reload for the Retry button (an event handler, not an
  // effect — setState there is unproblematic).
  const loadFirstPage = useCallback(() => {
    setLoading(true);
    setError(null);
    listDiscoverDecks({ page: 1 })
      .then((res) => {
        setDecks(res.decks);
        setPage(res.page);
        setHasMore(res.hasMore);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load public decks.');
      })
      .finally(() => setLoading(false));
  }, []);

  // Inline .then() chain on purpose, not a call to loadFirstPage above:
  // react-hooks/set-state-in-effect flags a synchronous setState reachable
  // from an effect body even through a wrapped function call (mirrors
  // FriendsPage.tsx's identical mount-effect/imperative-reload split).
  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks({ page: 1 })
      .then((res) => {
        if (cancelled) return;
        setDecks(res.decks);
        setPage(res.page);
        setHasMore(res.hasMore);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load public decks.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoadMore = useCallback(() => {
    setLoadingMore(true);
    setLoadMoreError(null);
    listDiscoverDecks({ page: page + 1 })
      .then((res) => {
        setDecks((prev) => [...prev, ...res.decks]);
        setPage(res.page);
        setHasMore(res.hasMore);
      })
      .catch((err: unknown) => {
        setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more decks.');
      })
      .finally(() => setLoadingMore(false));
  }, [page]);

  return (
    <>
      <DecksHubTabs />
      <div className="decks-index-page">
        <header className="binder-hero">
          <h1 className="binder-hero-name">Discover</h1>
          <p className="binder-hero-meta">Public decks from the SpellControl community.</p>
        </header>

        {loading ? (
          <>
            <p role="status" aria-live="polite" className="sr-only">
              Loading public decks…
            </p>
            <ul className="decks-index-list is-grid" aria-hidden="true">
              {Array.from({ length: DISCOVER_SKELETON_COUNT }, (_, i) => (
                <DiscoverTileSkeleton key={i} />
              ))}
            </ul>
          </>
        ) : error ? (
          <div className="discover-decks-error" role="alert">
            <span>{error}</span>
            <button type="button" className="discover-decks-error-retry" onClick={loadFirstPage}>
              Retry
            </button>
          </div>
        ) : decks.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-tagline">No public decks yet.</p>
            <p className="empty-state-hint">
              Publish one of your own from the Decks page to be the first.
            </p>
          </div>
        ) : (
          <>
            <ul className="decks-index-list is-grid" aria-label="Public decks">
              {decks.map((deck) => (
                <DiscoverDeckTile key={deck.slug} deck={deck} />
              ))}
            </ul>
            {loadMoreError ? (
              <div className="discover-decks-error" role="alert">
                <span>{loadMoreError}</span>
                <button
                  type="button"
                  className="discover-decks-error-retry"
                  onClick={handleLoadMore}
                >
                  Retry
                </button>
              </div>
            ) : (
              hasMore && (
                <div className="discover-decks-load-more">
                  <button
                    type="button"
                    className="btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                  >
                    {loadingMore && <span className="spinner" aria-hidden="true" />}
                    Load more
                  </button>
                </div>
              )
            )}
          </>
        )}
      </div>
    </>
  );
}
