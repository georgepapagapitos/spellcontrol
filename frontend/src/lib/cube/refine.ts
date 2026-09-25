// Local-search refiner for an owned-cards cube. The greedy fitter in ./generate
// is locally optimal per bucket and can't trade off across the whole cube; this
// takes its output as a SEED and hill-climbs the explicit objective in
// ./objective by swapping cards in/out of their bucket.
//
// Wide neighborhood, late-acceptance hill climb, deterministic:
//   - Every iteration samples FOCI_SAMPLE foci — draftable archetype axes, or
//     the curve/type/interaction/power term — via a PRNG seeded from the pool
//     itself (mulberry32, ../playtest/rng), evaluates up to CANDIDATES_PER_FOCUS
//     owned contributors per focus against the weakest cuttable in-bucket,
//     in-slot (±1) pick, and takes the single best-scoring candidate overall.
//   - Late-acceptance hill climbing (Burke & Bykov): that candidate is accepted
//     if it beats the CURRENT score OR the score from `LAHC_HISTORY` iterations
//     ago, so the climb can step through a temporary dip instead of stopping at
//     the first local optimum — but the BEST cube seen across the whole climb
//     is what's returned, never something worse than the seed.
//   - Same pool + size + level → identical result: the PRNG seed is a pure hash
//     of the pool's sorted oracleIds (order-independent) plus size and level,
//     no Date/Math.random anywhere.
//
// Bounded cost: each candidate is an O(1)/O(axes) incremental delta (see
// ./scorer-state) rather than a full O(size) rescore — the previous version's
// cost driver. Two more things that used to be redone per candidate/per focus
// are hoisted out: the swap-in candidate lists (pool-derived, so pool-constant
// across the whole climb — precomputed once in `buildCandidatePools`) and the
// cuttable swap-out list + role-ceiling tally (picks-derived, but unchanged
// across every focus tried within one iteration — computed once per iteration,
// not once per focus).

import type { GeneratedCube, Pick } from './generate';
import { bucketOf, curveSlotOf, type CubeCard } from './core';
import type { BandTargets, ColorBucket, CurveSlot, Role } from './targets';
import { mulberry32 } from '../playtest/rng';
import {
  AXIS_LABEL,
  computePowerBasis,
  contributes,
  draftablePoolAxes,
  rawPower,
  scoreCube,
  typeOf,
  TYPE_SLOTS,
  type CubeScore,
} from './objective';
import { applySwap, createScorerState, evalSwap, type ScorerState } from './scorer-state';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

/** How many top candidates to try per focus per iteration (bounds per-iteration cost). */
const CANDIDATES_PER_FOCUS = 6;
/** How many foci (of all draftable axes + the 4 environment terms) a single iteration samples. */
const FOCI_SAMPLE = 8;
const CURVE_SLOTS: CurveSlot[] = ['0', '1', '2', '3', '4', '5', '6', '7'];
type TypeSlot = (typeof TYPE_SLOTS)[number];
const EPS = 1e-9;
/** Late-acceptance history window — long enough to escape a shallow local optimum. */
const LAHC_HISTORY = 30;

/** An archetype axis, or one of the wider environment terms a focus can target. */
export type SwapFocus = AxisKey | 'curve' | 'type' | 'interaction' | 'power';

export interface SwapLogEntry {
  axis: SwapFocus;
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
  /** Full objective breakdown of the final picks (basis reused — no re-sort). */
  score: CubeScore;
}

const slotNum = (c: CubeCard) => Number(curveSlotOf(c.cmc));

const FOCUS_REASON: Record<'curve' | 'type' | 'interaction' | 'power', string> = {
  curve: 'Curve fit',
  type: 'Type fit',
  interaction: 'Interaction density',
  power: 'Power upgrade',
};
const reasonFor = (focus: SwapFocus, draftableSet: ReadonlySet<AxisKey>): string =>
  draftableSet.has(focus as AxisKey)
    ? `${AXIS_LABEL.get(focus as AxisKey) ?? focus} support`
    : FOCUS_REASON[focus as 'curve' | 'type' | 'interaction' | 'power'];

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
 * Cuttable picks, role-less filler first and weakest-first within each group
 * (see ./generate for why role cards go last — cutting them is how #1408's
 * interaction gutting happened). Depends only on `picks`, so the caller
 * computes this ONCE per iteration, not once per focus tried that iteration.
 */
function cuttableOuts(
  picks: Pick[],
  draftable: ReadonlySet<AxisKey>,
  power: (c: CubeCard) => number
): { p: Pick; idx: number }[] {
  return picks
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => bucketOf(p.card) !== 'land' && isCuttable(p.card, draftable))
    .sort(
      (a, b) =>
        Number(a.p.card.role != null) - Number(b.p.card.role != null) ||
        power(a.p.card) - power(b.p.card) ||
        a.p.card.oracleId.localeCompare(b.p.card.oracleId)
    );
}

/**
 * The pool's swap-in candidates, sliced one way per possible focus and
 * pre-sorted by power — built ONCE per `refineCube` call since the pool never
 * changes across the climb. `insForFocus` then just filters these (already
 * short, already sorted) lists by "not already picked / not at its role
 * ceiling" instead of re-filtering the WHOLE pool (thousands of cards on a
 * real collection) on every focus tried.
 */
interface CandidatePools {
  axis: Map<AxisKey, CubeCard[]>;
  curve: Record<CurveSlot, CubeCard[]>;
  type: Record<TypeSlot, CubeCard[]>;
  interaction: CubeCard[];
  power: CubeCard[];
}

function buildCandidatePools(
  pool: CubeCard[],
  draftableSet: ReadonlySet<AxisKey>,
  power: (c: CubeCard) => number
): CandidatePools {
  const nonland = pool.filter((c) => bucketOf(c) !== 'land');
  const sorted = [...nonland].sort(
    (a, b) => power(b) - power(a) || a.oracleId.localeCompare(b.oracleId)
  );
  const axis = new Map<AxisKey, CubeCard[]>();
  for (const ax of draftableSet)
    axis.set(
      ax,
      sorted.filter((c) => contributes(c, ax))
    );
  const curve = {} as Record<CurveSlot, CubeCard[]>;
  for (const s of CURVE_SLOTS) curve[s] = sorted.filter((c) => curveSlotOf(c.cmc) === s);
  const type = {} as Record<TypeSlot, CubeCard[]>;
  for (const t of TYPE_SLOTS) type[t] = sorted.filter((c) => typeOf(c) === t);
  const interaction = sorted.filter((c) => c.role === 'removal' || c.role === 'boardwipe');
  return { axis, curve, type, interaction, power: sorted };
}

/** Up to CANDIDATES_PER_FOCUS unpicked, uncapped cards from an already-sorted candidate list. */
function takeCandidates(
  list: CubeCard[],
  pickedIds: ReadonlySet<string>,
  atCap: (c: CubeCard) => boolean
): CubeCard[] {
  const out: CubeCard[] = [];
  for (const c of list) {
    if (out.length >= CANDIDATES_PER_FOCUS) break;
    if (pickedIds.has(c.oracleId) || atCap(c)) continue;
    out.push(c);
  }
  return out;
}

/** Candidate swap-INS for one focus, moving that focus's achieved value toward its target. */
function insForFocus(
  focus: SwapFocus,
  state: ScorerState,
  candidates: CandidatePools,
  pickedIds: ReadonlySet<string>,
  atCap: (c: CubeCard) => boolean,
  draftableSet: ReadonlySet<AxisKey>
): CubeCard[] {
  if (draftableSet.has(focus as AxisKey)) {
    return takeCandidates(candidates.axis.get(focus as AxisKey) ?? [], pickedIds, atCap);
  }
  switch (focus) {
    case 'curve': {
      let worst: CurveSlot | null = null;
      let worstDeficit = 0;
      for (const s of CURVE_SLOTS) {
        const deficit = state.curveTargetN[s] - state.curveFill[s];
        if (deficit > worstDeficit + EPS) {
          worstDeficit = deficit;
          worst = s;
        }
      }
      return worst ? takeCandidates(candidates.curve[worst], pickedIds, atCap) : [];
    }
    case 'type': {
      let worst: TypeSlot | null = null;
      let worstDeficit = 0;
      for (const t of TYPE_SLOTS) {
        const deficit = state.typeTargetShare[t] - state.typeCount[t] / state.pickCount;
        if (deficit > worstDeficit + EPS) {
          worstDeficit = deficit;
          worst = t;
        }
      }
      return worst ? takeCandidates(candidates.type[worst], pickedIds, atCap) : [];
    }
    case 'interaction': {
      const achieved = state.interactionCount / state.nonlandCount;
      return achieved < state.iTarget - EPS
        ? takeCandidates(candidates.interaction, pickedIds, atCap)
        : [];
    }
    case 'power':
      return takeCandidates(candidates.power, pickedIds, atCap);
    default:
      return [];
  }
}

interface Move {
  focus: SwapFocus;
  outIdx: number;
  outCard: CubeCard;
  inCard: CubeCard;
  newScore: number;
  reason: string;
  ev: ReturnType<typeof evalSwap>;
}

/** The best-scoring (not necessarily improving — LAHC decides that) swap for one focus this iteration. */
function bestMoveForFocus(
  focus: SwapFocus,
  state: ScorerState,
  candidates: CandidatePools,
  outs: { p: Pick; idx: number }[],
  pickedIds: ReadonlySet<string>,
  atCap: (c: CubeCard) => boolean,
  draftableSet: ReadonlySet<AxisKey>
): Move | null {
  const ins = insForFocus(focus, state, candidates, pickedIds, atCap, draftableSet);
  if (ins.length === 0) return null;

  let best: Move | null = null;
  for (const inCard of ins) {
    const inBucket = bucketOf(inCard);
    const inSlot = slotNum(inCard);
    let chosen: { p: Pick; idx: number } | undefined;
    for (const tol of [0, 1]) {
      chosen = outs.find(
        ({ p }) => bucketOf(p.card) === inBucket && Math.abs(slotNum(p.card) - inSlot) <= tol
      );
      if (chosen) break;
    }
    if (!chosen) continue;
    // skipPower: ranking candidates, not committing one — see scorer-state's
    // doc on evalSwap. The single winning candidate this iteration is
    // re-evaluated accurately before the accept decision (see refineCube).
    const ev = evalSwap(state, chosen.idx, inCard, true);
    if (!best || ev.terms.total > best.newScore) {
      best = {
        focus,
        outIdx: chosen.idx,
        outCard: chosen.p.card,
        inCard,
        newScore: ev.terms.total,
        reason: reasonFor(focus, draftableSet),
        ev,
      };
    }
  }
  return best;
}

/** Partial Fisher-Yates: the first `n` of `foci` in a PRNG-shuffled order (no replacement). */
function sampleFoci(foci: SwapFocus[], n: number, rand: () => number): SwapFocus[] {
  const arr = foci.slice();
  const take = Math.min(n, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}

/** Deterministic seed from the pool contents alone — order-independent (sorted ids). */
function deriveSeed(pool: CubeCard[], size: number, synergyLevel: number): number {
  const key = `${pool
    .map((c) => c.oracleId)
    .sort()
    .join('|')}#${size}#${synergyLevel}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Refine a greedy cube by hill-climbing the objective. `pool` is the full
 * deduplicated owned pool (the candidate set for swap-ins).
 */
export function refineCube(
  greedy: GeneratedCube,
  pool: CubeCard[],
  band: BandTargets,
  size: number,
  /** "Best cards ↔ Synergy" — how much of the objective sits on archetype depth. */
  synergyLevel = 1,
  /** Cube-level role ceilings (the corpus-median quotas); a role at its cap admits no swap-in. */
  roleCap: Partial<Record<Role, number>> = {},
  /**
   * Optional per-pass progress hook (worker relay for the loading UI). A pure
   * side effect — never read back, so it can't change the climb's output.
   */
  onProgress?: (pass: number, maxIter: number) => void
): RefineResult {
  const basis = computePowerBasis(pool);
  const power = (c: CubeCard) => rawPower(c, basis);

  const poolAxes = draftablePoolAxes(pool);
  const draftableSet = new Set(poolAxes);
  if (poolAxes.length === 0) {
    const scored = scoreCube(greedy.picks, pool, band, size, basis, synergyLevel);
    return {
      picks: greedy.picks.slice(),
      byBucket: { ...greedy.byBucket },
      swapLog: [],
      finalScore: scored.total,
      score: scored,
    };
  }

  const state = createScorerState(greedy.picks, pool, band, size, basis, synergyLevel);
  const pickedIds = new Set(state.picks.map((p) => p.card.oracleId));
  let bestPicks = state.picks.slice();
  let bestScore = state.terms.total;
  const swapLog: SwapLogEntry[] = [];

  const candidates = buildCandidatePools(pool, draftableSet, power);
  const FOCI: SwapFocus[] = [...poolAxes, 'curve', 'type', 'interaction', 'power'];
  const FOCI_PER_ITER = Math.min(FOCI_SAMPLE, FOCI.length);
  const MAX_ITER = Math.min(2 * size, 720);
  const historyLen = Math.max(1, Math.min(LAHC_HISTORY, MAX_ITER));
  const history = new Array(historyLen).fill(state.terms.total);
  const rand = mulberry32(deriveSeed(pool, size, synergyLevel));

  for (let iter = 0; iter < MAX_ITER; iter++) {
    onProgress?.(iter, MAX_ITER);

    // Cuttable swap-outs and the role-ceiling tally depend only on `state.picks`
    // — unchanged across every focus this iteration samples, so both are
    // computed once here rather than once per focus.
    const outs = cuttableOuts(state.picks, draftableSet, power);
    const roleCount = {} as Record<Role, number>;
    for (const p of state.picks)
      if (p.card.role) roleCount[p.card.role] = (roleCount[p.card.role] ?? 0) + 1;
    const atCap = (c: CubeCard) =>
      c.role != null && roleCap[c.role] != null && (roleCount[c.role] ?? 0) >= roleCap[c.role]!;

    // A random sample of the neighborhood this iteration (archetype axes +
    // the four environment terms), not just archetype axes — the "wider
    // search". Best-of-sample, not first-found: cheap now that each candidate
    // is an incremental delta, not a full rescore.
    const sample = sampleFoci(FOCI, FOCI_PER_ITER, rand);
    let best: Move | null = null;
    for (const focus of sample) {
      const move = bestMoveForFocus(focus, state, candidates, outs, pickedIds, atCap, draftableSet);
      if (move && (!best || move.newScore > best.newScore)) best = move;
    }
    // One accurate re-eval of the winning candidate only — the ranking above
    // used skipPower (stale power) to stay cheap across up to FOCI_PER_ITER ×
    // CANDIDATES_PER_FOCUS candidates; the accept decision below must not run
    // on a power-blind score, or a swap that's neutral on every OTHER term
    // (rare, but real — see refine.test.ts's cold-start axis test) reads as a
    // costless tie and gets waved through while actually eroding power.
    if (best) {
      const ev = evalSwap(state, best.outIdx, best.inCard);
      best = { ...best, ev, newScore: ev.terms.total };
    }
    const v = iter % historyLen;
    if (best && (best.newScore >= state.terms.total - EPS || best.newScore >= history[v] - EPS)) {
      const prevTotal = state.terms.total;
      const move = best;
      applySwap(state, move.outIdx, move.inCard, bucketOf(move.inCard), move.reason, move.ev);
      pickedIds.delete(move.outCard.oracleId);
      pickedIds.add(move.inCard.oracleId);
      swapLog.push({
        axis: move.focus,
        outName: move.outCard.name,
        inName: move.inCard.name,
        scoreDelta: state.terms.total - prevTotal,
      });
      if (state.terms.total > bestScore + EPS) {
        bestScore = state.terms.total;
        bestPicks = state.picks.slice();
      }
    }
    history[v] = state.terms.total;
  }

  const byBucket = {} as Record<ColorBucket, number>;
  for (const b of Object.keys(greedy.byBucket) as ColorBucket[]) byBucket[b] = 0;
  for (const p of bestPicks) {
    const b = bucketOf(p.card);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }

  // Final breakdown of the best-seen picks — the ground-truth full scorer,
  // both for API parity (score.axes is only ever computed here) and as a
  // cross-check against the incremental climb (see scorer-state.test.ts).
  const finalScored = scoreCube(bestPicks, pool, band, size, basis, synergyLevel);
  return { picks: bestPicks, byBucket, swapLog, finalScore: finalScored.total, score: finalScored };
}
