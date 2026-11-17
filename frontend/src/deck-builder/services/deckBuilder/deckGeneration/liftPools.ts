// Shared per-generation EDHREC lift pools (E71 slice 2). Every insertion
// point that wants lift data (owned-fallback re-rank, gap-analysis ranking,
// same-role tie-breaks) reads from the SAME fetched pools instead of each
// re-fetching a seed's card page — fetchCardLiftPool already caches per-slug
// for 30min, but sharing here also enforces one MAX_LIFT_SEEDS budget across
// the whole run instead of one per call site.
import type { LiftEntry } from '@/deck-builder/types';
import { fetchCardLiftPool } from '@/deck-builder/services/edhrec/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { buildLiftIndex } from '../liftSynergy';
import type { GenerationState } from './state';
import { calculateCardPriority } from '../cardPicking';

export const MAX_LIFT_SEEDS = 10;

/** This run's seed budget: the player's build-around cards (E1116) get their
 *  own slots, so they never crowd the commander's theme seeds out. */
export const liftSeedCap = (state: Pick<GenerationState, 'cfg'>): number =>
  MAX_LIFT_SEEDS + (state.cfg.buildAround?.length ?? 0);

/**
 * Fetch and merge lift pools for `seeds` into `state.liftSeedPools`, skipping
 * seeds already attempted (success or failure) and never exceeding
 * MAX_LIFT_SEEDS attempts total for the generation. Soft-fails per seed —
 * fetchCardLiftPool itself never throws, but this never propagates either.
 * Bails immediately (no attempts, existing map returned as-is) when the
 * generation has no EDHREC data, mirroring every other lift gate.
 */
export async function ensureLiftPools(
  state: GenerationState,
  seeds: string[]
): Promise<Map<string, LiftEntry[]>> {
  if (!state.edhrecData || state.noEdhrecReason) return state.liftSeedPools;

  for (const seed of seeds) {
    if (state.liftSeedsTried.has(seed)) continue;
    if (state.liftSeedsTried.size >= liftSeedCap(state)) break;
    state.liftSeedsTried.add(seed);
    try {
      const pool = await fetchCardLiftPool(seed);
      if (pool.length > 0) state.liftSeedPools.set(seed, pool);
    } catch {
      // soft-fail: seed stays "tried" (counts against the cap) with no pool
    }
  }
  return state.liftSeedPools;
}

/**
 * Lazily built, memoized index over every seed pool fetched so far this
 * generation. Rebuilt only when the pool count changes (a cheap proxy for
 * "ensureLiftPools added something since the last read") so repeated callers
 * within the same generation don't re-aggregate on every pick.
 */
export function getLiftIndex(
  state: GenerationState
): Map<string, { clusterScore: number; liftedBy: string[] }> {
  if (!state.liftIndexCache || state.liftIndexCache.size !== state.liftSeedPools.size) {
    state.liftIndexCache = {
      size: state.liftSeedPools.size,
      index: buildLiftIndex(state.liftSeedPools),
    };
  }
  return state.liftIndexCache.index;
}

/**
 * The lifters a disclosure may name: the ones in the deck right now. A lift
 * seed cut before the swap still sits in the lift index, and the reason named
 * it ("lifted by Goblin King" in a Krenko deck without one).
 */
export function liftersInDeck(
  liftedBy: readonly string[] | undefined,
  state: Pick<GenerationState, 'categories'>
): string[] | undefined {
  if (!liftedBy) return undefined;
  const inDeck = new Set<string>();
  for (const c of Object.values(state.categories).flat()) {
    inDeck.add(c.name.toLowerCase());
    inDeck.add(frontFaceName(c.name).toLowerCase());
  }
  return liftedBy.filter((n) => inDeck.has(n.toLowerCase()));
}

/**
 * Early lift-seed set (E71 slice 2), collected BEFORE any card is picked:
 * commander(s), then EDHREC-pool cards flagged isThemeSynergyCard, then
 * must-includes. Note isThemeSynergyCard is set on every EDHREC response's
 * highsynergy/topcards lists (not only theme-slug fetches), so in a no-theme
 * build these seeds are the commander's own base high-synergy cards — the
 * same theme-independent bias picking already applies via isHighSynergyCard.
 * No implicit "lift as theme" switch: with no selected theme the fetched
 * pool is the base commander page, never a theme page.
 * Deduped, capped at MAX_LIFT_SEEDS. Deck cards picked later add further
 * seeds via phaseLiftPicks' own collectSeeds, sharing the same pool/cap.
 */
export function collectEarlyLiftSeeds(state: GenerationState): string[] {
  const seeds: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    if (!name || seen.has(name) || seeds.length >= liftSeedCap(state)) return;
    seen.add(name);
    seeds.push(name);
  };

  add(state.context.commander.name);
  add(state.context.partnerCommander?.name);
  // E1116: the player's build-around cards lead, ahead of the page's own
  // theme cards, which otherwise fill the cap before a must-include is reached.
  for (const name of state.cfg.buildAround ?? []) add(name);
  if (state.edhrecData) {
    const themeCards = state.edhrecData.cardlists.allNonLand
      .filter((c) => c.isThemeSynergyCard)
      .sort(
        (a, b) =>
          calculateCardPriority(b, state.cfg.brewLevel) -
          calculateCardPriority(a, state.cfg.brewLevel)
      );
    for (const c of themeCards) add(c.name);
  }
  for (const name of state.mustIncludeNames) add(name);

  return seeds;
}
