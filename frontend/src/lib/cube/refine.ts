// Local-search refiner for an owned-cards cube. The greedy fitter in ./generate
// is locally optimal per bucket and can't trade off across the whole cube; this
// takes its output as a SEED and hill-climbs the explicit objective in
// ./objective by swapping cards in/out of their bucket.
//
// Worst-axis targeted, strictly-improving, deterministic:
//   - Each pass scores the cube, finds the weakest-supported archetype axis,
//     and tries to swap a non-contributing pick for an owned card that does
//     contribute — staying in the same color bucket and (±1) curve slot so the
//     greedy's balance is preserved.
//   - A swap is accepted only if it raises the objective (pure hill-climb, no
//     annealing → no randomness, no risk of accepting a worse cube).
//   - Same pool + size → identical result (stable sorts, oracleId tiebreaks).
//
// Bounded cost: the objective is O(size) and we evaluate a small fixed number of
// candidates per pass, capped at MAX_ITER passes — sub-10ms for a 540 cube.

import type { CubeCard, GeneratedCube, Pick } from './generate';
import { bucketOf, curveSlotOf } from './generate';
import type { BandTargets, ColorBucket } from './targets';
import {
  AXIS_LABEL,
  contributes,
  computeRankP80,
  draftablePoolAxes,
  rawPower,
  scoreCube,
  type CubeScore,
} from './objective';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

/** How many top candidates to try per axis per pass (bounds per-pass cost). */
const CANDIDATES_PER_AXIS = 6;
const EPS = 1e-9;

export interface SwapLogEntry {
  axis: AxisKey;
  outName: string;
  inName: string;
  scoreDelta: number;
}

export interface RefineResult {
  picks: Pick[];
  /** Unchanged from the seed — swaps are same-bucket — but recomputed for safety. */
  byBucket: Record<ColorBucket, number>;
  swapLog: SwapLogEntry[];
  finalScore: number;
  /** Full objective breakdown of the final picks (rankP80 reused — no re-sort). */
  score: CubeScore;
}

const slotNum = (c: CubeCard) => Number(curveSlotOf(c.cmc));

/**
 * Cards the refiner is allowed to cut: pure goodstuff with no archetype role,
 * OR cards whose EVERY tagged axis is non-draftable in this pool (e.g. a mill
 * enabler when the pool has no mill payoff) — dead weight a real archetype card
 * strictly improves on. A card carrying even one draftable axis is never cut, so
 * the refiner still can't rob one live strategy to feed another.
 */
const isCuttable = (c: CubeCard, draftable: ReadonlySet<AxisKey>): boolean => {
  const axes = [...(c.synergyProducers ?? []), ...(c.synergyPayoffs ?? [])];
  if (axes.length === 0) return true;
  return axes.every((a) => !draftable.has(a));
};

/**
 * Find the best objective-improving swap that adds an enabler/payoff for `axis`.
 * Tries the top-N owned contributors (by power) against the weakest in-bucket,
 * in-slot non-contributing pick. Returns null if nothing improves the score.
 */
function bestSwapForAxis(
  axis: AxisKey,
  picks: Pick[],
  pickedIds: Set<string>,
  pool: CubeCard[],
  band: BandTargets,
  size: number,
  currentScore: number,
  rankP80: number,
  power: (c: CubeCard) => number,
  draftable: ReadonlySet<AxisKey>
): { picks: Pick[]; out: CubeCard; in: CubeCard; newScore: number } | null {
  const ins = pool
    .filter((c) => !pickedIds.has(c.oracleId) && bucketOf(c) !== 'land' && contributes(c, axis))
    .sort((a, b) => power(b) - power(a) || a.oracleId.localeCompare(b.oracleId))
    .slice(0, CANDIDATES_PER_AXIS);
  if (ins.length === 0) return null;

  // Weakest-first cuttable picks. We only cut pure goodstuff filler or dead-axis
  // cards (see isCuttable) — never a card carrying a live archetype, so the
  // refiner can't rob one strategy (or a greedy-reserved floor, or a multi-axis
  // glue card) to feed another. It only converts spare/dead slots into synergy.
  const outs = picks
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => bucketOf(p.card) !== 'land' && isCuttable(p.card, draftable))
    .sort(
      (a, b) =>
        power(a.p.card) - power(b.p.card) || a.p.card.oracleId.localeCompare(b.p.card.oracleId)
    );

  let best: { picks: Pick[]; out: CubeCard; in: CubeCard; newScore: number } | null = null;
  for (const inCard of ins) {
    const inBucket = bucketOf(inCard);
    const inSlot = slotNum(inCard);
    // Weakest cuttable pick in the same bucket, exact slot first then ±1.
    let chosen: { p: Pick; idx: number } | undefined;
    for (const tol of [0, 1]) {
      chosen = outs.find(
        ({ p }) => bucketOf(p.card) === inBucket && Math.abs(slotNum(p.card) - inSlot) <= tol
      );
      if (chosen) break;
    }
    if (!chosen) continue;
    const candidate = picks.slice();
    candidate[chosen.idx] = {
      card: inCard,
      bucket: chosen.p.bucket,
      reason: `${AXIS_LABEL.get(axis) ?? axis} support`,
    };
    const newScore = scoreCube(candidate, pool, band, size, rankP80).total;
    if (newScore > currentScore + EPS && (!best || newScore > best.newScore)) {
      best = { picks: candidate, out: chosen.p.card, in: inCard, newScore };
    }
  }
  return best;
}

/**
 * Refine a greedy cube by hill-climbing the objective. `pool` is the full
 * deduplicated owned pool (the candidate set for swap-ins).
 */
export function refineCube(
  greedy: GeneratedCube,
  pool: CubeCard[],
  band: BandTargets,
  size: number
): RefineResult {
  const rankP80 = computeRankP80(pool);
  const power = (c: CubeCard) => rawPower(c, rankP80);

  let picks = greedy.picks.slice();
  const pickedIds = new Set(picks.map((p) => p.card.oracleId));
  let scored = scoreCube(picks, pool, band, size, rankP80);
  let currentScore = scored.total;
  const swapLog: SwapLogEntry[] = [];

  const poolAxes = draftablePoolAxes(pool);
  const draftableSet = new Set(poolAxes);
  if (poolAxes.length === 0) {
    return {
      picks,
      byBucket: { ...greedy.byBucket },
      swapLog,
      finalScore: currentScore,
      score: scored,
    };
  }

  const MAX_ITER = Math.min(2 * size, 720);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    scored = scoreCube(picks, pool, band, size, rankP80);
    const axisScore = new Map(scored.axes.map((a) => [a.axis, a.score]));
    // Weakest-supported draftable axis first (absent from the cube = 0);
    // lexicographic tiebreak for determinism (M13).
    const ranked = [...poolAxes].sort(
      (a, b) => (axisScore.get(a) ?? 0) - (axisScore.get(b) ?? 0) || a.localeCompare(b)
    );
    let applied = false;
    for (const axis of ranked) {
      const swap = bestSwapForAxis(
        axis,
        picks,
        pickedIds,
        pool,
        band,
        size,
        currentScore,
        rankP80,
        power,
        draftableSet
      );
      if (swap) {
        picks = swap.picks;
        pickedIds.delete(swap.out.oracleId);
        pickedIds.add(swap.in.oracleId);
        swapLog.push({
          axis,
          outName: swap.out.name,
          inName: swap.in.name,
          scoreDelta: swap.newScore - currentScore,
        });
        currentScore = swap.newScore;
        applied = true;
        break;
      }
    }
    if (!applied) break; // local optimum
  }

  const byBucket = {} as Record<ColorBucket, number>;
  for (const b of Object.keys(greedy.byBucket) as ColorBucket[]) byBucket[b] = 0;
  for (const p of picks) {
    const b = bucketOf(p.card);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }

  // Final breakdown of the climbed picks (rankP80 reused — no pool re-sort).
  const finalScored = scoreCube(picks, pool, band, size, rankP80);
  return { picks, byBucket, swapLog, finalScore: finalScored.total, score: finalScored };
}
