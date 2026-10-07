/**
 * The upgrade plan's judge on the deck page (E540 S9): builds the whole-deck
 * objective for the saved deck while the plan sheet is open, and hands the
 * plan a `PlanJudge` (plan-move-judge.ts).
 *
 * States, each of which the sheet has a face for:
 *  - idle      the sheet is closed: nothing is built;
 *  - loading   the objective is loading (the sheet shows its skeleton);
 *  - ready     a judge: the plan offers only moves the objective accepts;
 *  - fallback  the deck cannot be scored (no EDHREC page, a thin one, no role
 *              targets) or the build threw: the plan runs on its own rules,
 *              as the Cuts lane keeps today's rows.
 */
import { useEffect, useRef, useState } from 'react';
import { getCachedCard } from '@/deck-builder/services/scryfall/client';
import { logger } from '@/lib/util/logger';
import { loadSourcesObjective, type CutSwapSources } from './objective-for-deck';
import { createPlanJudge, type PlanJudge } from './plan-move-judge';

export type PlanJudgeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; judge: PlanJudge }
  | { status: 'fallback'; reason: string };

/** `hold`: the deck's combos are still loading, and the objective reads them. */
export function usePlanJudge(
  sources: CutSwapSources | undefined,
  enabled: boolean,
  hold = false
): PlanJudgeState {
  const [settled, setSettled] = useState<{ key: string; state: PlanJudgeState } | null>(null);
  const deck = sources?.deck;
  // The judge answers for the deck's cards as they stand and the combos it was built with.
  const key = deck
    ? `${deck.id}#${deck.cards.map((c) => c.card.name).join('|')}#${deck.bracketOverride ?? ''}#${
        sources.combos ? sources.combos.inDeck.length + ':' + sources.combos.oneAway.length : ''
      }#${sources.owned.length}`
    : '';
  const active = enabled && !hold && sources !== undefined;
  // The run reads the latest sources; it restarts only when `key` or `active` changes.
  const latest = useRef(sources);
  useEffect(() => {
    latest.current = sources;
  });

  useEffect(() => {
    const src = latest.current;
    if (!active || !src) return;
    let cancelled = false;
    void (async () => {
      let state: PlanJudgeState;
      try {
        const objective = await loadSourcesObjective(src);
        const judge = createPlanJudge(objective, getCachedCard);
        state = judge
          ? { status: 'ready', judge }
          : { status: 'fallback', reason: objective.ok ? 'error' : objective.reason };
      } catch (err) {
        logger.warn('[coach] plan judge failed', err);
        state = { status: 'fallback', reason: 'error' };
      }
      if (!cancelled) setSettled({ key, state });
    })();
    return () => {
      cancelled = true;
    };
  }, [active, key]);

  if (!enabled) return { status: 'idle' };
  if (!sources) return { status: 'fallback', reason: 'no-sources' };
  if (settled?.key === key) return settled.state;
  return { status: 'loading' };
}
