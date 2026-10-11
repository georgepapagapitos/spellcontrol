import { useEffect, useState } from 'react';
import type { SetMap } from '@/lib/api';
import type { Deck } from '@/store/decks';
import type { BinderDef, EnrichedCard } from '@/types/index';
import { buildBinderPlacement, buildPullList, isPullableKind } from './pull-list';
import type { AllocationInfo } from './allocations';

export type DeckPullCounts = Map<string, { pullable: number; total: number }>;

/** Pull-readiness per deck: how many of its cards have a free copy in a binder. */
export function computeDeckPullCounts(
  decks: readonly Deck[],
  collectionCards: EnrichedCard[],
  binderDefs: BinderDef[],
  allocations: Map<string, AllocationInfo>,
  setMap: SetMap | undefined
): DeckPullCounts | null {
  if (binderDefs.length === 0) return null;
  // The expensive step, materializing every binder, runs once for the whole
  // page; each deck then only pays slot resolution.
  const placement = buildBinderPlacement(collectionCards, binderDefs, setMap);
  const counts: DeckPullCounts = new Map();
  for (const deck of decks) {
    let pullable = 0;
    let total = 0;
    const groups = buildPullList(deck, collectionCards, binderDefs, allocations, setMap, placement);
    for (const g of groups) {
      for (const r of g.rows) {
        total += r.qty;
        if (isPullableKind(g.kind)) pullable += r.qty;
      }
    }
    if (total > 0) counts.set(deck.id, { pullable, total });
  }
  return binderDefs.length === 0 ? null : counts;
}

/** Quiet period before a recompute, so a burst of input changes costs one. */
export const PULL_COUNTS_SETTLE_MS = 120;

/**
 * `computeDeckPullCounts`, kept OFF the render path.
 *
 * On a 12k-card account the compute is 350-500 ms of main thread, and its
 * inputs change identity several times as a warm reload settles (cards, then
 * allocations, then the set map). Computed inside render it held the deck tiles
 * back for the first run and re-blocked the page on every later one (measured
 * on /decks, warm: four runs, 337-492 ms each). The badge is a refinement of a
 * tile, so the tiles paint first and the counts arrive once the inputs settle.
 * The previous counts stay up meanwhile, so a badge never blinks out.
 */
export function useDeckPullCounts(
  decks: readonly Deck[],
  collectionCards: EnrichedCard[],
  binderDefs: BinderDef[],
  allocations: Map<string, AllocationInfo>,
  setMap: SetMap | undefined
): DeckPullCounts | null {
  const [counts, setCounts] = useState<DeckPullCounts | null>(null);
  useEffect(() => {
    if (binderDefs.length === 0) return;
    const timer = setTimeout(() => {
      setCounts(computeDeckPullCounts(decks, collectionCards, binderDefs, allocations, setMap));
    }, PULL_COUNTS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [decks, collectionCards, binderDefs, allocations, setMap]);
  return binderDefs.length === 0 ? null : counts;
}
