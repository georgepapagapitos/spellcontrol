import { useEffect } from 'react';
import { recordShown, recordSuggestion } from '@/lib/util/suggestion-labels';
import type { SuggestionRow } from '@/lib/coach/deck-suggestions';
import type { useDismissedSuggestions } from '@/lib/coach/dismissed-suggestions';

/**
 * Suggestion labels (E518) for the Add panel's three groups, and its "Not for
 * this deck" (E580): which group a row sits in decides the surface it is labeled
 * with, and the rank is its place inside that group.
 */
export function useAddSuggestionLabels(
  staples: SuggestionRow[],
  combos: SuggestionRow[],
  gems: SuggestionRow[],
  hidden: ReturnType<typeof useDismissedSuggestions>
) {
  useEffect(() => {
    recordShown('add-suggestions', staples.length);
    recordShown('add-combos', combos.length);
    recordShown('hidden-gems', gems.length);
  }, [staples.length, combos.length, gems.length]);

  const locate = (name: string) => {
    const groups = [
      { rows: staples, surface: 'add-suggestions', reason: 'staple' },
      { rows: combos, surface: 'add-combos', reason: 'combos' },
      { rows: gems, surface: 'hidden-gems', reason: 'hidden-gem' },
    ] as const;
    for (const g of groups) {
      const i = g.rows.findIndex((r) => r.name === name);
      if (i >= 0) return { surface: g.surface, reason: g.reason, rank: i + 1 };
    }
    return null;
  };

  const labelAdd = (name: string) => {
    const at = locate(name);
    if (at) recordSuggestion({ ...at, action: 'accept', cardIn: name });
  };

  /** The row's "Not for this deck", or undefined when no deck is open. */
  const dismissFor = (name: string) => {
    const at = locate(name);
    if (!at || !hidden.canDismiss) return undefined;
    return () => hidden.dismiss({ ...at, name, cardIn: name });
  };

  return { labelAdd, dismissFor };
}
