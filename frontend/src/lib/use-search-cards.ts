import { useEffect, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_QUERY_LENGTH = 2;

interface UseSearchCardsResult<T> {
  results: T[];
  loading: boolean;
  error: string | null;
}

interface UseSearchCardsOptions<T> {
  /**
   * Fetcher run on the trimmed, debounced query. Defaults to Scryfall
   * `searchCards` (skipFormatFilter). Must be a STABLE reference (module-level
   * fn or `useCallback`) — it's an effect dependency, so a fresh closure each
   * render re-fires the search.
   */
  fetcher?: (query: string) => Promise<T[]>;
  /** Max results kept from the response. Default 60. */
  limit?: number;
  /** Min trimmed query length before fetching. Default 2; pass 0 to fetch on empty. */
  minLength?: number;
  /** Debounce in ms. Default 300. */
  debounceMs?: number;
  /** When false the hook stays idle (no fetch, results/loading/error cleared). Default true. */
  enabled?: boolean;
}

const defaultFetcher = (q: string): Promise<ScryfallCard[]> =>
  searchCards(q, [], { skipFormatFilter: true }).then((resp) => resp.data);

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
    fetcher = defaultFetcher as unknown as (q: string) => Promise<T[]>,
    limit = 60,
    minLength = DEFAULT_MIN_QUERY_LENGTH,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enabled = true,
  } = opts;

  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (!enabled || q.length < minLength) {
        if (!cancelled) {
          setResults([]);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, debounceMs);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetcher(q);
        if (!cancelled) setResults(data.slice(0, limit));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, limit, fetcher, minLength, debounceMs, enabled]);

  return { results, loading, error };
}
