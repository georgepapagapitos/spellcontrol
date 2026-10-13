import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnrichedCard } from '@/types/index';
import type { AllocationInfo } from '@/lib/collection/allocations';
import { printingFinishKey } from '@spellcontrol/binder-routing';
import { fetchTypeSuggestions } from '@/lib/cards/scryfall-catalog';
import { isTypingTarget, useRegisterShortcuts } from '@/components/app-shell/shortcut-registry';
import { collectSubtypeTokens, mergeSubtypeSuggestions } from './card-list-table-derive';
import { COLLECTION_SHORTCUTS, type ViewMode } from './card-list-table-config';

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
 *  grouped. Indexed by printing (scryfallId + finish, the row key) once so per-row lookups
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
      const key = printingFinishKey(c);
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
      const key = printingFinishKey(c);
      return allocationsByPrinting?.get(key) ?? [];
    },
    [groupPrintings, allocations, allocationsByPrinting]
  );
}

/** The Collection hotkeys (search focus, view switches, add) while the table is
 *  mounted, plus their entry in the `?` overlay. */
export function useCollectionHotkeys(
  setView: (v: ViewMode) => void,
  onAddCards: ((query?: string) => void) | undefined
): void {
  // Global hotkeys while the table is mounted. We ignore key events when the
  // user is typing into an input/textarea/contenteditable so the shortcuts
  // don't fight with normal text entry.
  // NOTE: `?` is handled globally by Layout's ShortcutRegistryProvider.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === '/') {
        const el = document.getElementById('collection-search');
        if (el instanceof HTMLInputElement) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }
      if (e.key === 'g') {
        e.preventDefault();
        setView('grid');
        return;
      }
      if (e.key === 'l') {
        e.preventDefault();
        setView('list');
        return;
      }
      if (e.key === 'c') {
        e.preventDefault();
        setView('compact');
        return;
      }
      if (e.key === 'a') {
        e.preventDefault();
        onAddCards?.();
        return;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onAddCards, setView]);

  // Register the Collection shortcut section while this table is mounted.
  // The `?` overlay is owned by Layout; we contribute our shortcuts to the
  // registry so they appear under the "Collection" section automatically.
  useRegisterShortcuts('Collection', COLLECTION_SHORTCUTS);
}
