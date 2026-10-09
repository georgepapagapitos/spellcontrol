import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnrichedCard } from '@/types/index';
import type { AllocationInfo } from '@/lib/collection/allocations';
import { fetchTypeSuggestions } from '@/lib/cards/scryfall-catalog';
import { collectSubtypeTokens, mergeSubtypeSuggestions } from './card-list-table-derive';

// The self-contained hooks CardListTable calls, lifted out of its body (T176).
// Each one is the exact state + effect/memo block that sat inline, with no
// inputs beyond the arguments below.

/** True at <= 640px. On narrow viewports the top zoom steps all render as a
 *  single full-width column, so the reachable range is capped (without
 *  overwriting the stored preference, so it returns when the user resizes
 *  back up). */
export function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsNarrow(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return isNarrow;
}

/** Subtype autocomplete suggestions: the full Scryfall type catalog merged
 *  with the collection's own subtype tokens. Read once at mount. */
export function useSubtypeSuggestions(cards: EnrichedCard[]): string[] {
  const [subtypeSuggestions, setSubtypeSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const collectionSubtypeTokens = collectSubtypeTokens(cards);
    // Canceled on unmount: the catalog promise can outlive the component
    // (flaked CI: a setState after vitest tore the DOM env down).
    let cancelled = false;
    fetchTypeSuggestions().then((catalog) => {
      if (cancelled) return;
      setSubtypeSuggestions(mergeSubtypeSuggestions(catalog, collectionSubtypeTokens));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return subtypeSuggestions;
}

/** Allocations covering a card: per copy when ungrouped, per printing when
 *  grouped. Indexed by printing (scryfallId + foil) once so per-row lookups
 *  stay O(1); without it, every call would scan allCards, and the preview
 *  carousel calls it once per row. */
export function useAllocationsFor(
  groupPrintings: boolean,
  allCards: EnrichedCard[],
  allocations: Map<string, AllocationInfo>
): (c: EnrichedCard) => AllocationInfo[] {
  const allocationsByPrinting = useMemo(() => {
    if (!groupPrintings) return null;
    const map = new Map<string, AllocationInfo[]>();
    for (const c of allCards) {
      const a = allocations.get(c.copyId);
      if (!a) continue;
      const key = `${c.scryfallId}:${c.foil ? 'foil' : 'nonfoil'}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [groupPrintings, allCards, allocations]);
  return useCallback(
    (c: EnrichedCard): AllocationInfo[] => {
      if (!groupPrintings) {
        const a = allocations.get(c.copyId);
        return a ? [a] : [];
      }
      const key = `${c.scryfallId}:${c.foil ? 'foil' : 'nonfoil'}`;
      return allocationsByPrinting?.get(key) ?? [];
    },
    [groupPrintings, allocations, allocationsByPrinting]
  );
}
