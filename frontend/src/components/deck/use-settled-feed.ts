/**
 * The Coach feed's first paint (E627). The combos check lands after the rest of the
 * analysis and its completions rank to the top, so painting early meant rows
 * appeared and then reshuffled. This holds the skeleton until the sources have
 * settled (analysis ready and combos checked, for at most CUT_PAIRING_BUDGET_MS),
 * then keeps the order of the first paint: a source that lands later puts its rows
 * after the painted ones. The order resets when the deck or the view (`epochExtra`)
 * changes. Render-phase adjustment (react.dev "storing information from previous
 * renders"), so no stale frame commits.
 */
import { useEffect, useMemo, useState } from 'react';
import { CUT_PAIRING_BUDGET_MS } from '@/lib/coach/coach-cut-swaps';

export function useSettledFeed<T extends { change: { id: string } }>(opts: {
  fresh: readonly T[];
  deckNames: ReadonlySet<string>;
  /** Anything else that legitimately re-ranks the feed (filters, target bracket). */
  epochExtra: string;
  /** The analysis is pending, errored or EDHREC-less: its own skeleton shows. */
  analysisBlocked: boolean;
  combosLoading: boolean;
}): { ranked: readonly T[]; holding: boolean } {
  const { fresh, deckNames, epochExtra, analysisBlocked, combosLoading } = opts;
  const deckKey = useMemo(() => [...deckNames].sort().join('|'), [deckNames]);
  const epochKey = `${deckKey}#${epochExtra}`;
  const [feed, setFeed] = useState({ deck: '', epoch: '', ids: [] as string[], settled: false });
  const sameDeck = feed.deck === deckKey;
  const holding =
    !analysisBlocked && combosLoading && !(sameDeck && (feed.settled || feed.ids.length > 0));
  if (!holding) {
    const base = sameDeck && feed.epoch === epochKey ? feed.ids : [];
    const known = new Set(base);
    const added = fresh.map((r) => r.change.id).filter((id) => !known.has(id));
    const settled = (sameDeck && feed.settled) || (!analysisBlocked && !combosLoading);
    if (!sameDeck || feed.epoch !== epochKey || added.length > 0 || settled !== feed.settled) {
      setFeed({ deck: deckKey, epoch: epochKey, ids: [...base, ...added], settled });
    }
  }
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(
      () =>
        setFeed((f) => ({
          deck: deckKey,
          epoch: f.deck === deckKey ? f.epoch : '',
          ids: f.deck === deckKey ? f.ids : [],
          settled: true,
        })),
      CUT_PAIRING_BUDGET_MS
    );
    return () => clearTimeout(t);
  }, [holding, deckKey]);
  const ranked = useMemo(() => {
    if (feed.epoch !== epochKey) return fresh;
    const at = new Map(feed.ids.map((id, i) => [id, i] as const));
    // Painted rows keep their place; the rest follow in rank order (the sort is stable).
    return [...fresh].sort(
      (a, b) => (at.get(a.change.id) ?? Infinity) - (at.get(b.change.id) ?? Infinity)
    );
  }, [fresh, feed, epochKey]);
  return { ranked, holding };
}

/**
 * Which skeleton the feed wears, if any. A partial analysis (EDHREC unreachable) has
 * `analysisState === 'ready'` (a real bracket exists), but every lane is
 * EDHREC-derived, so the feed stays empty: same notice-with-retry shape as
 * pending/error, reworded.
 */
export function feedSkeletonStatus(
  analysisState: 'pending' | 'ready' | 'error',
  edhrecMissing: boolean
): 'pending' | 'error' | 'edhrec-missing' | null {
  if (analysisState === 'pending') return 'pending';
  if (analysisState === 'error') return 'error';
  return edhrecMissing ? 'edhrec-missing' : null;
}
