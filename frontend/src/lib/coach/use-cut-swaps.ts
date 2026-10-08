/**
 * The deck page's pairing of Coach's cuts with their replacements (E540 S6):
 * builds the whole-deck objective for the saved deck, resolves the cards Coach
 * offers, and runs `pairCuts` off the main thread's critical path (it waits for
 * the page every 40 ms, optimizerAsync.ts's slice).
 *
 * States, all of which the Cuts lane has a face for:
 *  - idle      nothing to pair;
 *  - loading   the first pairing is running (the lane shows its skeleton, for
 *              at most CUT_PAIRING_BUDGET_MS);
 *  - ready     verdicts per cut. A re-run after an apply keeps the last verdicts
 *              on screen until the new ones land, so rows never blink out;
 *  - fallback  the deck cannot be scored (no EDHREC page, a thin one, no role
 *              targets): the lane keeps today's rows;
 *  - error     something threw: today's rows and a retry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCachedCard, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { logger } from '@/lib/util/logger';
import { coachExclusions } from '@/deck-builder/services/deckBuilder/coachExclusions';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import type { Change, ChangeOwnership } from './deck-change';
import { loadSourcesObjective, type CutSwapSources } from './objective-for-deck';
import {
  CUT_PAIRING_BUDGET_MS,
  ownedInIdentity,
  pairCuts,
  replacementCandidateNames,
  stablePlan,
  type CutOutcome,
  type CutSwapState,
} from './coach-cut-swaps';
import type { SettingsBreak } from './deck-settings-fit';
import { dismissedNames } from './dismissed-suggestions';

export type { CutSwapSources };

export interface CutSwapEnv {
  resolveOwnership: (name: string) => ChangeOwnership;
  settingsBreak?: (change: Change) => SettingsBreak | null;
}

/** The cards by name: the cache first, then one batched fetch for the rest. */
async function resolveCards(names: readonly string[]): Promise<Map<string, ScryfallCard>> {
  const found = new Map<string, ScryfallCard>();
  const missing: string[] = [];
  for (const n of names) {
    const c = getCachedCard(n);
    if (c) found.set(n, c);
    else missing.push(n);
  }
  if (missing.length > 0) {
    try {
      for (const [n, c] of await getCardsByNames(missing)) found.set(n, c);
    } catch {
      // Whatever resolved still pairs; a candidate that did not is simply not offered.
    }
  }
  return found;
}

export function useCutSwaps(
  cuts: readonly Change[],
  sources: CutSwapSources | undefined,
  env: CutSwapEnv,
  /** The deck's combos are still loading: the objective reads them, so wait rather than run twice. */
  hold = false
): { state: CutSwapState; retry: () => void } {
  // The last verdict and the run it answers; a newer run's key leaves it stale.
  const [settled, setSettled] = useState<{ key: string; value: CutSwapState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The run reads the latest inputs; it restarts only when the cuts or the deck's cards change.
  const latest = useRef({ cuts, sources, env });
  useEffect(() => {
    latest.current = { cuts, sources, env };
  });
  const cutsKey = cuts.map((c) => c.id).join('|');
  const hasSources = sources !== undefined;
  const deck = sources?.deck;
  const deckKey = deck
    ? `${deck.cards.map((c) => c.card.name).join('|')}#${deck.bracketOverride ?? ''}#${
        sources.combos ? sources.combos.inDeck.length + ':' + sources.combos.oneAway.length : ''
      }#${sources.owned.length}`
    : '';
  const idle = !hasSources || cutsKey === '';
  const runKey = `${cutsKey}#${deckKey}#${attempt}`;

  // When the lane first waited on this run: the 4 s budget counts from there, so the
  // skeleton never outlasts it (a wait on the combos included).
  const shown = useRef<ReadonlyMap<string, CutOutcome> | undefined>(undefined);
  const started = useRef({ key: '', at: 0, gaveUp: false });
  useEffect(() => {
    if (idle) return;
    // The same cuts waiting on the deck's combos are one wait: the key leaves the deck out.
    const waitKey = `${cutsKey}#${attempt}`;
    if (started.current.key !== waitKey)
      started.current = { key: waitKey, at: Date.now(), gaveUp: false };
    if (started.current.gaveUp) return;
    const t0 = started.current.at;
    let cancelled = false;
    const settle = (value: CutSwapState) => {
      if (cancelled) return;
      shown.current = value.status === 'ready' ? value.outcomes : undefined;
      setSettled({ key: runKey, value });
    };
    if (hold) {
      // The combos are still loading: wait for them, but not past the budget. Without
      // them the objective would misjudge a combo piece, so the lane keeps today's rows.
      const timer = setTimeout(
        () => {
          started.current.gaveUp = true;
          settle({ status: 'fallback', reason: 'combos-slow' });
        },
        Math.max(0, CUT_PAIRING_BUDGET_MS - (Date.now() - t0))
      );
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    void (async () => {
      const { cuts: allCuts, sources: src, env: e } = latest.current;
      if (!src) return;
      try {
        const tRun = Date.now();
        const tGc = tRun;
        const d = src.deck;
        const objective = await loadSourcesObjective(src);
        const tObjective = Date.now();
        if (cancelled) return;
        if (!objective.ok) {
          settle({ status: 'fallback', reason: objective.reason });
          return;
        }
        const mainboard = d.cards.map((c) => c.card);
        // What the build removed on purpose, and graveyard hate in a deck that recurses.
        const excluded = coachExclusions(
          d.buildReport,
          mainboard,
          analyzeDeckSynergy(mainboard),
          dismissedNames(d.dismissedSuggestions)
        );
        const names = replacementCandidateNames({
          gaps: d.gapAnalysis,
          hiddenGems: d.hiddenGems,
          additions: d.optimizeSwaps?.additions,
          synergy: d.synergyAnalysis?.suggestions,
          // A collection deck searches the whole collection, narrowed to what the
          // deck's colors allow before any card is fetched or scored.
          ownedNames: d.generationContext?.collectionMode
            ? ownedInIdentity(
                src.owned,
                objective.ctx.colorIdentity,
                new Set(mainboard.map((c) => c.name))
              )
            : undefined,
          excluded,
        });
        const cards = await resolveCards(names);
        const tPair = Date.now();
        if (cancelled) return;
        const inDeckNow = new Set(mainboard.map((c) => c.name.toLowerCase()));
        const plan = stablePlan(shown.current, allCuts, (n) => inDeckNow.has(n.toLowerCase()));
        const toPair = plan.toPair;
        const paired = await pairCuts(toPair, {
          objective,
          resolve: (n) => cards.get(n) ?? getCachedCard(n),
          candidates: [...cards.values()],
          ownership: e.resolveOwnership,
          settingsBreak: e.settingsBreak,
          budgetMs: Math.max(0, CUT_PAIRING_BUDGET_MS - (Date.now() - t0)),
          cancelled: () => cancelled,
          pins: plan.pins,
        });
        const outcomes = new Map([...paired, ...plan.kept]);
        logger.debug('[coach] cut pairing', {
          cuts: toPair.length,
          candidates: cards.size,
          holdMs: tRun - t0,
          gameChangersMs: tGc - tRun,
          objectiveMs: tObjective - tGc,
          resolveMs: tPair - tObjective,
          pairMs: Date.now() - tPair,
          unscored: [...outcomes.values()].filter((o) => o.status === 'unscored').length,
        });
        settle({ status: 'ready', outcomes });
      } catch (err) {
        logger.warn('[coach] cut pairing failed', err);
        settle({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idle, hold, runKey, cutsKey, attempt]);

  let state: CutSwapState;
  if (idle) state = { status: 'idle' };
  else if (settled?.key === runKey) state = settled.value;
  // A re-run (an apply changed the deck) keeps the last verdicts until the new ones land.
  else if (settled && (settled.value.status === 'ready' || settled.value.status === 'fallback'))
    state = settled.value;
  else state = { status: 'loading' };
  return { state, retry };
}
