import { useCallback, useEffect, useRef, useState } from 'react';
import { searchCollectibleCards } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

import { userMessage } from '@/lib/util/user-error';
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_QUERY_LENGTH = 2;

interface UseSearchCardsResult<T> {
  results: T[];
  loading: boolean;
  error: string | null;
  /**
   * How many results the search actually MATCHED, when the fetcher can say —
   * not how many are held. `results` is capped at `limit`, so without this a
   * caller can only describe its own window and ends up implying the window
   * is everything: /tags picked a tag with 976 cards and the stack said
   * "Show 10 more · 50 not shown" (board E341). null when the fetcher returns
   * a bare array, because then the true total is unknown.
   */
  total: number | null;
  /**
   * Paged mode only (see `paged`): Scryfall has pages beyond the ones held.
   * Always false otherwise.
   */
  hasMore: boolean;
  /** Paged mode: the next page is in flight. Separate from `loading`, which stays false. */
  loadingMore: boolean;
  /** Paged mode: the last next-page fetch failed. Held results are untouched. */
  moreError: string | null;
  /**
   * Paged mode: fetch the next Scryfall page and append it. Resolves true when
   * the page landed, false when it failed, was superseded by a query change,
   * or there was nothing to fetch. Safe to call twice: one request at a time.
   */
  loadMore: () => Promise<boolean>;
}

/** A fetcher that knows the true match count reports it alongside the page. */
export interface SearchPage<T> {
  items: T[];
  total: number;
}

interface UseSearchCardsOptions<T> {
  /**
   * Fetcher run on the trimmed, debounced query. Defaults to Scryfall
   * `searchCards` (skipFormatFilter). Must be a STABLE reference (module-level
   * fn or `useCallback`) — it's an effect dependency, so a fresh closure each
   * render re-fires the search.
   *
   * Return a bare array, or a `SearchPage` when the endpoint reports a match
   * count the page should be able to state (`total`).
   */
  fetcher?: (query: string) => Promise<T[] | SearchPage<T>>;
  /** Max results kept from the response. Default 60. */
  limit?: number;
  /** Min trimmed query length before fetching. Default 2; pass 0 to fetch on empty. */
  minLength?: number;
  /** Debounce in ms. Default 300. */
  debounceMs?: number;
  /** When false the hook stays idle (no fetch, results/loading/error cleared). Default true. */
  enabled?: boolean;
  /**
   * Keep every card Scryfall returns instead of cutting at `limit`, and let
   * `loadMore()` pull the following pages (board E341). Default false: the
   * add-card sheets keep their 60-card preview. Only the default Scryfall
   * fetcher pages; with a custom `fetcher` this is ignored.
   */
  paged?: boolean;
}

// Every default caller searches for something to own or look at, not to play,
// so tokens belong in the results (see searchCollectibleCards).
const defaultFetcher = (q: string): Promise<SearchPage<ScryfallCard>> =>
  searchCollectibleCards(q).then((resp) => ({
    items: resp.data,
    // Scryfall's own count for the whole query, not the page it returned.
    total: resp.total_cards,
  }));

/** Items with an `id` dedupe across pages; Scryfall's order can shift between requests. */
function appendUnique<T>(held: T[], incoming: T[]): T[] {
  const seen = new Set<unknown>();
  for (const h of held) seen.add((h as { id?: unknown }).id ?? h);
  const fresh = incoming.filter((i) => {
    const key = (i as { id?: unknown }).id ?? i;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return fresh.length ? [...held, ...fresh] : held;
}

/**
 * Debounced search hook. Defaults to Scryfall card search, but accepts a custom
 * `fetcher` (any result type) so callers that search a different endpoint —
 * commander autocomplete, valid-partner lookup — reuse the same debounce /
 * loading / error / cancellation machinery instead of re-rolling it.
 *
 * Each call site keeps its own UI-side state (visible count, open printings,
 * active index) — those side effects don't belong here.
 */
export function useSearchCards(query: string, limit?: number): UseSearchCardsResult<ScryfallCard>;
export function useSearchCards<T>(
  query: string,
  options: UseSearchCardsOptions<T>
): UseSearchCardsResult<T>;
export function useSearchCards<T = ScryfallCard>(
  query: string,
  arg?: number | UseSearchCardsOptions<T>
): UseSearchCardsResult<T> {
  const opts: UseSearchCardsOptions<T> =
    typeof arg === 'number' || arg === undefined ? { limit: arg } : arg;
  const {
    fetcher = defaultFetcher as unknown as (q: string) => Promise<T[] | SearchPage<T>>,
    limit = 60,
    minLength = DEFAULT_MIN_QUERY_LENGTH,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enabled = true,
    paged: pagedOpt = false,
  } = opts;
  const paged = pagedOpt && opts.fetcher === undefined;

  const [results, setResults] = useState<T[]>([]);
  // Born pending when the first query is already searchable (a deep link):
  // the effect below runs AFTER the first paint, and that one frame of
  // `loading: false` + no results printed "No cards on Scryfall match" for
  // 44ms on /search?q=… (playtest batch 10, after the effect-side fix).
  const [loading, setLoading] = useState(() => enabled && query.trim().length >= minLength);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  // Cancels the in-flight debounce wait: clears its timer AND settles its
  // promise, so a superseded `run()` exits through `if (cancelled) return`
  // instead of hanging on a promise nothing will ever resolve.
  // Paging cursor: the next Scryfall page number, null when exhausted.
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Bumped whenever the query (or any search input) changes. A next-page
  // response checks it so a page for the OLD query is dropped, not appended.
  const generationRef = useRef(0);
  const moreInFlightRef = useRef(false);
  const queryRef = useRef('');
  const debounceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    generationRef.current += 1;
    moreInFlightRef.current = false;
    async function run() {
      setNextPage(null);
      setLoadingMore(false);
      setMoreError(null);
      const q = query.trim();
      if (!enabled || q.length < minLength) {
        if (!cancelled) {
          setResults([]);
          setError(null);
          setTotal(null);
          setLoading(false);
        }
        return;
      }
      // Pending from the first keystroke, not from the end of the debounce:
      // every consumer renders "no matches" off `!loading && results.length
      // === 0`, so a query still waiting out its 300ms read as a query with
      // no results — on /search a deep link said "No cards on Scryfall match"
      // for 300ms before its first request, and while typing the line re-lied
      // after every keystroke (playtest batch 10).
      setLoading(true);
      setError(null);
      debounceRef.current?.();
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, debounceMs);
        debounceRef.current = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
      debounceRef.current = null;
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const page = await fetcher(q);
        const items = Array.isArray(page) ? page : page.items;
        if (!cancelled) {
          queryRef.current = q;
          setResults(paged ? items : items.slice(0, limit));
          const pageTotal = Array.isArray(page) ? null : page.total;
          setTotal(pageTotal);
          // Another page exists when Scryfall matched more than page one held.
          setNextPage(paged && pageTotal !== null && pageTotal > items.length ? 2 : null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            userMessage(e, "Couldn't run that search. Check your connection and try again.")
          );
          setResults([]);
          setTotal(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      debounceRef.current?.();
    };
  }, [query, limit, fetcher, minLength, debounceMs, enabled, paged]);

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!paged || nextPage === null || moreInFlightRef.current) return false;
    const generation = generationRef.current;
    const q = queryRef.current;
    moreInFlightRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const resp = await searchCollectibleCards(q, nextPage);
      if (generation !== generationRef.current) return false;
      setResults((held) => appendUnique(held, resp.data as unknown as T[]));
      setNextPage(resp.has_more && resp.data.length > 0 ? nextPage + 1 : null);
      return true;
    } catch (e) {
      if (generation !== generationRef.current) return false;
      setMoreError(
        userMessage(e, "Couldn't load more results. Check your connection and try again.")
      );
      return false;
    } finally {
      if (generation === generationRef.current) {
        moreInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [paged, nextPage]);

  return {
    results,
    loading,
    error,
    total,
    hasMore: nextPage !== null,
    loadingMore,
    moreError,
    loadMore,
  };
}
