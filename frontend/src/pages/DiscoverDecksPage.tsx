import './DiscoverDecksPage.css';
import { LayoutGrid, List as ListIconLucide } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DecksHubTabs } from '../components/DecksHubTabs';
import {
  DiscoverDeckTile,
  DiscoverTileSkeleton,
  DISCOVER_SKELETON_COUNT,
  type DiscoverTileView,
} from '../components/DiscoverDeckTile';
import { DiscoverFiltersPopover } from '../components/DiscoverFiltersPopover';
import { TrendingRail } from '../components/aggregates/TrendingRail';
import { CommanderTypeahead } from '../components/CommanderTypeahead';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { listDiscoverDecks, type DiscoverDeck, type DiscoverSortKey } from '../lib/discover-client';
import {
  parseDiscoverFiltersFromSearchParams,
  discoverFiltersToSearchParams,
  NO_DISCOVER_FILTERS,
  type DiscoverFilters,
} from '../lib/discover-filters';
import { computeBuildablePercent } from '../lib/discover-buildable';
import { useStoredSort } from '../lib/use-stored-sort';
import { useStoredView } from '../lib/use-stored-view';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';

type DiscoverSortField = DiscoverSortKey | 'buildable';

// No sort here has a real asc/desc — the server always orders each column
// one way, and `buildable` wants highest-percent-first. `useStoredSort`'s dir
// is only ever flipped by re-picking the same option in the dropdown, which
// is inert since it's never read; kept only to reuse that hook's persistence
// (DecksIndexPage's own pattern) rather than hand-rolling one.
const DISCOVER_SORT_DIR: Record<DiscoverSortField, 'asc' | 'desc'> = {
  newest: 'desc',
  'most-copied': 'desc',
  'most-viewed': 'desc',
  buildable: 'desc',
};

const BASE_SORT_OPTIONS: SelectOption<DiscoverSortField>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'most-copied', label: 'Most copied' },
  { value: 'most-viewed', label: 'Most viewed' },
];

/**
 * /decks/discover — filterable/sortable browse of every public deck on the
 * platform (`w2-discover-filters-sort`). Unauthenticated read — the
 * commander typeahead, filters popover, and grid/list toggle work
 * identically for guests and signed-in users; only the `buildable` sort
 * (percent of the viewer's OWN collection each deck builds from) is
 * authed + non-empty-collection gated, and is computed entirely client-side
 * — never sent to the server.
 */
export function DiscoverDecksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  // Memoized off that stable string key, not the `searchParams` object
  // itself (react-router doesn't guarantee its identity is stable across
  // renders) — so the fetch effect/callbacks below can depend on `filters`
  // directly without refetching on every unrelated re-render.
  const filters = useMemo(
    () => parseDiscoverFiltersFromSearchParams(new URLSearchParams(searchKey)),
    [searchKey]
  );
  const setFilters = (next: DiscoverFilters) =>
    setSearchParams(discoverFiltersToSearchParams(next), { replace: true });

  const authed = useAuth((s) => s.status === 'authed');
  const collectionCards = useCollectionStore((s) => s.cards);
  const buildableAvailable = authed && collectionCards.length > 0;
  // Oracle ids the viewer owns — mirrors `ownership-lens.ts`'s own
  // `byOracle` construction (same store, same field, same undefined-filter).
  const ownedOracleIds = useMemo(() => {
    if (!buildableAvailable) return null;
    const set = new Set<string>();
    for (const c of collectionCards) if (c.oracleId) set.add(c.oracleId);
    return set;
  }, [buildableAvailable, collectionCards]);

  const sortOptions = useMemo<SelectOption<DiscoverSortField>[]>(
    () =>
      buildableAvailable
        ? [...BASE_SORT_OPTIONS, { value: 'buildable', label: 'Percent buildable' }]
        : BASE_SORT_OPTIONS,
    [buildableAvailable]
  );
  const { sortField, toggleSort } = useStoredSort<DiscoverSortField>(
    'discover-sort',
    DISCOVER_SORT_DIR,
    'newest'
  );
  const [view, setView] = useStoredView<DiscoverTileView>(
    'discover-view',
    ['grid', 'list'],
    'grid'
  );

  // `buildable` never reaches the server — it re-sorts the already-fetched
  // page(s) client-side below.
  const serverSort: DiscoverSortKey = sortField === 'buildable' ? 'newest' : sortField;

  const [decks, setDecks] = useState<DiscoverDeck[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Always-current ref for handleLoadMore's async callback below to check
  // itself against — a load-more in flight when the sort/filters change
  // underneath it must not append its (now stale) results onto the fresh
  // page-1 list the effect below just replaced them with. Updated from an
  // effect, never during render (react-hooks/refs forbids the latter).
  const fetchKey = `${serverSort}|${searchKey}`;
  const fetchKeyRef = useRef(fetchKey);
  useEffect(() => {
    fetchKeyRef.current = fetchKey;
  }, [fetchKey]);

  // Render-phase reset when the fetch key changes — React's own recommended
  // alternative to a synchronous setState at the top of an effect body (which
  // react-hooks/set-state-in-effect flags as cascading an extra render); same
  // "previous value" comparison idiom CommanderSearch.tsx's `prevOwnedOnly`
  // already uses in this codebase. Resets to page 1, discarding the
  // accumulated Load-More list and any stale load-more error, per spec.
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey);
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
  }

  // Imperative reload for the Retry button (an event handler, not an
  // effect — setState there is unproblematic).
  const loadFirstPage = useCallback(() => {
    setLoading(true);
    setError(null);
    listDiscoverDecks({ page: 1, sort: serverSort, ...filters })
      .then((res) => {
        setDecks(res.decks);
        setPage(res.page);
        setHasMore(res.hasMore);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load public decks.');
      })
      .finally(() => setLoading(false));
  }, [serverSort, filters]);

  // Fetches page 1 whenever sort/filters change (the render-phase block
  // above already flipped `loading`/reset `error` for this render). Every
  // setState here lives inside the promise callbacks, not the effect body
  // itself, so react-hooks/set-state-in-effect has nothing to flag.
  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks({ page: 1, sort: serverSort, ...filters })
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
  }, [serverSort, filters]);

  const handleLoadMore = useCallback(() => {
    const requestKey = fetchKey;
    setLoadingMore(true);
    setLoadMoreError(null);
    listDiscoverDecks({ page: page + 1, sort: serverSort, ...filters })
      .then((res) => {
        // Stale — sort/filters changed (and page 1 already reloaded) while
        // this request was in flight; discard rather than append.
        if (fetchKeyRef.current !== requestKey) return;
        setDecks((prev) => [...prev, ...res.decks]);
        setPage(res.page);
        setHasMore(res.hasMore);
      })
      .catch((err: unknown) => {
        setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more decks.');
      })
      .finally(() => setLoadingMore(false));
  }, [page, serverSort, filters, fetchKey]);

  // Client-side buildable resort over the full accumulated (all Load-More
  // pages fetched so far) list. Stable: a fresh `[...decks].sort()` off the
  // same fetch-order source array ties-breaks by that original order every
  // time (Array#sort is spec-guaranteed stable), so repeated renders of the
  // same decks/ownedOracleIds don't jitter tile order.
  const displayDecks = useMemo(() => {
    if (sortField !== 'buildable' || !ownedOracleIds) return decks;
    return [...decks].sort(
      (a, b) =>
        computeBuildablePercent(b.cardOracleIds, ownedOracleIds) -
        computeBuildablePercent(a.cardOracleIds, ownedOracleIds)
    );
  }, [decks, sortField, ownedOracleIds]);

  const hasActiveFilters =
    filters.commander != null ||
    filters.format != null ||
    filters.brackets.length > 0 ||
    filters.colors.length > 0 ||
    filters.budget != null;

  return (
    <>
      <DecksHubTabs />
      <div className="decks-index-page">
        <header className="binder-hero">
          <h1 className="binder-hero-name">Discover</h1>
          <p className="binder-hero-meta">Public decks from the SpellControl community.</p>
        </header>

        <TrendingRail enabled={true} />

        <div className="discover-toolbar">
          <CommanderTypeahead
            value={filters.commander}
            onChange={(commander) => setFilters({ ...filters, commander })}
          />
          <DiscoverFiltersPopover filters={filters} onChange={setFilters} />
          <SelectMenu
            value={sortField}
            options={sortOptions}
            onChange={toggleSort}
            ariaLabel="Sort discover decks by"
          />
          <ViewModeToggle<DiscoverTileView>
            ariaLabel="Discover view mode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'grid',
                label: 'Grid view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view',
                icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>

        {filters.budget != null && (
          <p className="discover-budget-note">
            Some decks may not appear until pricing is available.
          </p>
        )}

        {loading ? (
          <>
            <p role="status" aria-live="polite" className="sr-only">
              Loading public decks…
            </p>
            <ul className={`decks-index-list is-${view}`} aria-hidden="true">
              {Array.from({ length: DISCOVER_SKELETON_COUNT }, (_, i) => (
                <DiscoverTileSkeleton key={i} view={view} />
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
        ) : displayDecks.length === 0 ? (
          hasActiveFilters ? (
            <div className="empty-state">
              <p className="empty-state-tagline">No public decks match these filters.</p>
              <button
                type="button"
                className="btn-link"
                onClick={() => setFilters(NO_DISCOVER_FILTERS)}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <EmptyStateMark />
              <p className="empty-state-tagline">No public decks yet.</p>
              <p className="empty-state-hint">
                Publish one of your own from the Decks page to be the first.
              </p>
            </div>
          )
        ) : (
          <>
            <ul className={`decks-index-list is-${view}`} aria-label="Public decks">
              {displayDecks.map((deck) => (
                <DiscoverDeckTile
                  key={deck.slug}
                  deck={deck}
                  view={view}
                  buildablePercent={
                    ownedOracleIds
                      ? computeBuildablePercent(deck.cardOracleIds, ownedOracleIds)
                      : null
                  }
                />
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
