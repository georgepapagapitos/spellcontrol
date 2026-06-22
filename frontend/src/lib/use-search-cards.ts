import { useEffect, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

interface UseSearchCardsResult {
  results: ScryfallCard[];
  loading: boolean;
  error: string | null;
}

/**
 * Debounced Scryfall card search hook. Shared by the collection add-card panel,
 * inline search, scanner queue sheet, and list entries view.
 *
 * Fires `searchCards` (skipFormatFilter=true) after a 300ms debounce whenever
 * `query` changes. Returns nothing until `query.trim()` reaches 2 characters.
 * Each call site keeps its own UI-side state (visible count, open printings,
 * active index) — those side effects don't belong here.
 *
 * @param query  Raw search string (trimming happens internally).
 * @param limit  Max results to keep from Scryfall's response. Default 60.
 */
export function useSearchCards(query: string, limit = 60): UseSearchCardsResult {
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < MIN_QUERY_LENGTH) {
        if (!cancelled) {
          setResults([]);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, DEBOUNCE_MS);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) setResults(resp.data.slice(0, limit));
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
  }, [query, limit]);

  return { results, loading, error };
}
