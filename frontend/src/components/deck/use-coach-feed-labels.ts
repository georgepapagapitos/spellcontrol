import { useCallback, useEffect } from 'react';
import type { Change } from '@/lib/coach/deck-change';
import { useDismissedSuggestions } from '@/lib/coach/dismissed-suggestions';
import type { PlanStep } from '@/lib/coach/apply-upgrade-plan';
import {
  recordShown,
  recordSuggestion,
  suggestionInputForChange,
  type SuggestionSurface,
} from '@/lib/util/suggestion-labels';

/**
 * Suggestion labels (E518) for the Coach feed: which lane showed how many rows,
 * and which row the player accepted at what rank. A nested stand-in takes its
 * parent row's rank. The payload is built in lib/util/suggestion-labels.ts.
 */
export function useCoachFeedLabels(filter: string, rows: Change[], loading: boolean) {
  const surface = `coach:${filter}` as SuggestionSurface;
  useEffect(() => {
    if (!loading) recordShown(surface, rows.length);
  }, [surface, rows.length, loading]);

  const rankOf = useCallback(
    (c: Change) =>
      rows.findIndex((r) => r.id === c.id || r.alternatives?.some((a) => a.id === c.id)) + 1,
    [rows]
  );
  const accept = useCallback(
    (c: Change) => recordSuggestion(suggestionInputForChange(c, surface, rankOf(c))),
    [surface, rankOf]
  );
  const acceptAll = useCallback((changes: Change[]) => changes.forEach(accept), [accept]);
  /** The upgrade plan applies steps, not rows: a step has no rank of its own. */
  const acceptPlan = useCallback((steps: PlanStep[]) => {
    steps.forEach((s, i) =>
      recordSuggestion({
        surface: 'coach:plan',
        action: 'accept',
        rank: i + 1,
        reason: 'upgrade-plan',
        cardIn: s.addName,
        cardOut: s.cutName ?? undefined,
      })
    );
  }, []);
  const { dismiss: hide } = useDismissedSuggestions();
  /** "Not for this deck": hides the row for this deck and labels it a dismissal. */
  const dismiss = useCallback(
    (c: Change) => {
      const input = suggestionInputForChange(c, surface, rankOf(c));
      hide({
        name: c.name,
        cut: c.type === 'cut',
        surface,
        rank: input.rank,
        reason: input.reason,
        cardIn: input.cardIn,
        cardOut: input.cardOut,
      });
    },
    [hide, surface, rankOf]
  );
  return { accept, acceptAll, acceptPlan, dismiss };
}
