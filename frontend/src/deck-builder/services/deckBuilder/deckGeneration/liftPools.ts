// Shared per-generation EDHREC lift pools (E71 slice 2). Every insertion
// point that wants lift data (owned-fallback re-rank, gap-analysis ranking,
// same-role tie-breaks) reads from the SAME fetched pools instead of each
// re-fetching a seed's card page — fetchCardLiftPool already caches per-slug
// for 30min, but sharing here also enforces one MAX_LIFT_SEEDS budget across
// the whole run instead of one per call site.
import type { LiftEntry } from '@/deck-builder/types';
import { fetchCardLiftPool } from '@/deck-builder/services/edhrec/client';
import { buildLiftIndex } from '../liftSynergy';
import type { GenerationState } from './state';

export const MAX_LIFT_SEEDS = 10;

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
  if (!state.edhrecData) return state.liftSeedPools;

  for (const seed of seeds) {
    if (state.liftSeedsTried.has(seed)) continue;
    if (state.liftSeedsTried.size >= MAX_LIFT_SEEDS) break;
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
