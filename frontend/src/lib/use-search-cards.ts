import { useEffect, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

import { userMessage } from '@/lib/user-error';
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
  // Born pending when the first query is already searchable (a deep link):
  // the effect below runs AFTER the first paint, and that one frame of
  // `loading: false` + no results printed "No cards on Scryfall match" for
  // 44ms on /search?q=… (playtest batch 10, after the effect-side fix).
  const [loading, setLoading] = useState(() => enabled && query.trim().length >= minLength);
  const [error, setError] = useState<string | null>(null);
  // Cancels the in-flight debounce wait: clears its timer AND settles its
  // promise, so a superseded `run()` exits through `if (cancelled) return`
  // instead of hanging on a promise nothing will ever resolve.
  const debounceRef = useRef<(() => void) | null>(null);

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
        const data = await fetcher(q);
        if (!cancelled) setResults(data.slice(0, limit));
      } catch (e) {
        if (!cancelled) {
          setError(
            userMessage(e, "Couldn't run that search. Check your connection and try again.")
          );
          setResults([]);
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
  }, [query, limit, fetcher, minLength, debounceMs, enabled]);

  return { results, loading, error };
}
