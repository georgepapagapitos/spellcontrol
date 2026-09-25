// Incremental scorer for refine.ts's hill-climb. `scoreCube` (./objective) is
// O(size) per call — cheap once, too expensive to call per candidate when a
// pass now tries a much wider neighborhood. This module tallies the same seven
// terms as running aggregates and applies one swap (out card → in card, same
// bucket) as a delta instead of a full rescore.
//
// Six terms are true O(1)/O(axes): color and the fixing multiplier are
// constant for the whole climb (swaps never change a bucket's count or the
// land count — see refine.ts), archetype only needs the ≤2 axes the swapped
// cards touch, and glue/curve/interaction/type only touch the one or two
// slots/categories the swap moves a card into or out of. Power is left as an
// O(size) re-sort per eval — allowed by design (see the cube-refine brief)
// rather than a hand-rolled sorted structure; at size ≤ 720 it's still cheap,
// and it's the one term this module doesn't try to be clever about.
//
// Contract: evalSwap + applySwap must produce EXACTLY what
// `scoreCube(picksWithTheSwapApplied, ...)` would — see scorer-state.test.ts's
// property test (many random in-bucket swaps on a real-shaped pool, incremental
// vs scoreCube within 1e-12).

import type { Pick } from './generate';
import { bucketOf, curveSlotOf, isLand, COLORS, type CubeCard } from './core';
import type { BandTargets, ColorBucket, CurveSlot } from './targets';
import {
  axisScoreOf,
  draftablePoolAxes,
  fit,
  glueScoreOf,
  minDepth,
  powerTerm,
  targetArchetypeCount,
  typeOf,
  weightsFor,
  TYPE_SLOTS,
  type AxisAgg,
  type PowerBasis,
} from './objective';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

const CURVE_SLOTS: CurveSlot[] = ['0', '1', '2', '3', '4', '5', '6', '7'];
type TypeSlot = (typeof TYPE_SLOTS)[number];

/** The seven scored terms, matching `CubeScore` minus the `axes` breakdown. */
export interface ScoreTerms {
  archetype: number;
  glue: number;
  color: number;
  curve: number;
  interaction: number;
  power: number;
  type: number;
  fixingMultiplier: number;
  total: number;
}

export interface ScorerState {
  picks: Pick[];
  band: BandTargets;
  basis: PowerBasis;
  weights: ReturnType<typeof weightsFor>;
  minDepth: number;
  k: number;
  draftable: AxisKey[];
  draftableSet: ReadonlySet<AxisKey>;
  pickCount: number;
  nonlandCount: number;

  axisData: Map<AxisKey, AxisAgg>;
  axisScore: Map<AxisKey, number>;

  glueSum: number;
  curveFill: Record<CurveSlot, number>;
  curveFit: Record<CurveSlot, number>;
  curveFitSum: number; // raw sum of curveFit — kept alongside the /8 average to avoid re-deriving it by multiply-then-divide on every swap
  curveTargetN: Record<CurveSlot, number>;
  curveTol: Record<CurveSlot, number>;

  typeCount: Record<TypeSlot, number>;
  typeFit: Record<TypeSlot, number>;
  typeFitSum: number; // raw sum of typeFit, same reason as curveFitSum
  typeTargetShare: Record<TypeSlot, number>;
  typeTol: Record<TypeSlot, number>;

  interactionCount: number;
  iTarget: number;
  iTol: number;

  terms: ScoreTerms;
}

/** Everything a swap needs to (a) decide whether to accept it and (b) apply it in O(1). */
export interface SwapEval {
  terms: ScoreTerms;
  axisUpdates: Map<AxisKey, { agg: AxisAgg; score: number }>;
  glueSum: number;
  curveFitSum: number;
  curveOut?: { slot: CurveSlot; fill: number; fitVal: number };
  curveIn?: { slot: CurveSlot; fill: number; fitVal: number };
  typeFitSum: number;
  typeOut?: { slot: TypeSlot; count: number; fitVal: number };
  typeIn?: { slot: TypeSlot; count: number; fitVal: number };
  interactionCount?: number;
}

function archetypeFrom(draftable: AxisKey[], k: number, get: (ax: AxisKey) => number): number {
  if (k === 0) return 1; // M4 — nothing draftable, nothing to penalize
  const scores = draftable.map(get).sort((a, b) => b - a);
  return scores.slice(0, k).reduce((s, v) => s + v, 0) / k;
}

/** Build the initial state from a seed cube — one O(size) pass, same shape as scoreCube. */
export function createScorerState(
  picks: Pick[],
  pool: CubeCard[],
  band: BandTargets,
  size: number,
  basis: PowerBasis,
  synergyLevel: number
): ScorerState {
  const cards = picks.map((p) => p.card);
  const pickCount = Math.max(1, cards.length);
  const nonland = cards.filter((c) => !isLand(c));
  const nonlandCount = Math.max(1, nonland.length);
  const minDepthVal = minDepth(size);
  const draftable = draftablePoolAxes(pool);
  const draftableSet = new Set(draftable);

  const axisData = new Map<AxisKey, AxisAgg>();
  const ensure = (ax: AxisKey) => {
    let d = axisData.get(ax);
    if (!d) {
      d = { e: 0, y: 0, buckets: {} };
      axisData.set(ax, d);
    }
    return d;
  };
  for (const c of cards) {
    const b = bucketOf(c);
    const touched = new Set<AxisKey>();
    for (const ax of c.synergyProducers ?? []) {
      if (!draftableSet.has(ax)) continue;
      ensure(ax).e++;
      touched.add(ax);
    }
    for (const ax of c.synergyPayoffs ?? []) {
      if (!draftableSet.has(ax)) continue;
      ensure(ax).y++;
      touched.add(ax);
    }
    for (const ax of touched) {
      const d = ensure(ax);
      d.buckets[b] = (d.buckets[b] ?? 0) + 1;
    }
  }
  const axisScore = new Map<AxisKey, number>();
  for (const ax of draftable) {
    const d = axisData.get(ax);
    axisScore.set(ax, d ? axisScoreOf(ax, d, minDepthVal) : 0);
  }
  const k = Math.min(draftable.length, targetArchetypeCount(size));
  const archetype = archetypeFrom(draftable, k, (ax) => axisScore.get(ax) ?? 0);

  let glueSum = 0;
  for (const c of cards) glueSum += glueScoreOf(c);
  const glue = cards.length ? glueSum / cards.length : 0;

  const byBucket = {} as Record<ColorBucket, number>;
  for (const c of cards) {
    const b = bucketOf(c);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }
  let colorSum = 0;
  for (const c of COLORS) {
    const share = (byBucket[c] ?? 0) / pickCount;
    const t = band.color[c];
    const tol = Math.max(0.01, (t.p75 - t.p25) / 2);
    colorSum += fit(Math.abs(share - t.median), tol);
  }
  const color = colorSum / COLORS.length;

  const curveFill = {} as Record<CurveSlot, number>;
  const curveFit = {} as Record<CurveSlot, number>;
  const curveTargetN = {} as Record<CurveSlot, number>;
  const curveTol = {} as Record<CurveSlot, number>;
  for (const s of CURVE_SLOTS) curveFill[s] = 0;
  for (const c of nonland) curveFill[curveSlotOf(c.cmc)]++;
  let curveSum = 0;
  for (const s of CURVE_SLOTS) {
    const t = band.curve[s];
    curveTargetN[s] = t.median * nonlandCount;
    curveTol[s] = Math.max(1, ((t.p75 - t.p25) * nonlandCount) / 2);
    const f = fit(Math.abs(curveFill[s] - curveTargetN[s]), curveTol[s]);
    curveFit[s] = f;
    curveSum += f;
  }
  const curve = curveSum / CURVE_SLOTS.length;

  const interactionCount = cards.filter(
    (c) => c.role === 'removal' || c.role === 'boardwipe'
  ).length;
  const iTarget = band.role.removal.median + band.role.boardwipe.median;
  const iP25 = band.role.removal.p25 + band.role.boardwipe.p25;
  const iP75 = band.role.removal.p75 + band.role.boardwipe.p75;
  const iTol = Math.max(0.01, (iP75 - iP25) / 2);
  const interaction = fit(Math.abs(interactionCount / nonlandCount - iTarget), iTol);

  const typeCount = {} as Record<TypeSlot, number>;
  const typeFit = {} as Record<TypeSlot, number>;
  const typeTargetShare = {} as Record<TypeSlot, number>;
  const typeTol = {} as Record<TypeSlot, number>;
  for (const t of TYPE_SLOTS) typeCount[t] = 0;
  for (const c of cards) {
    const t = typeOf(c);
    if (t && (TYPE_SLOTS as readonly string[]).includes(t)) typeCount[t as TypeSlot]++;
  }
  let typeSum = 0;
  for (const t of TYPE_SLOTS) {
    const tgt = band.type[t];
    typeTargetShare[t] = tgt.median;
    typeTol[t] = Math.max(0.01, (tgt.p75 - tgt.p25) / 2);
    const f = fit(Math.abs(typeCount[t] / pickCount - tgt.median), typeTol[t]);
    typeFit[t] = f;
    typeSum += f;
  }
  const type = typeSum / TYPE_SLOTS.length;

  const power = powerTerm(cards, basis);
  const landCount = byBucket['land'] ?? 0;
  const fixingMultiplier = landCount < band.fixingLands.p25 * 0.5 ? 0.75 : 1;

  const weights = weightsFor(synergyLevel);
  const weighted =
    weights.archetype * archetype +
    weights.glue * glue +
    weights.color * color +
    weights.curve * curve +
    weights.interaction * interaction +
    weights.power * power +
    weights.type * type;
  const total = fixingMultiplier * weighted;

  return {
    picks: picks.slice(),
    band,
    basis,
    weights,
    minDepth: minDepthVal,
    k,
    draftable,
    draftableSet,
    pickCount,
    nonlandCount,
    axisData,
    axisScore,
    glueSum,
    curveFill,
    curveFit,
    curveFitSum: curveSum,
    curveTargetN,
    curveTol,
    typeCount,
    typeFit,
    typeFitSum: typeSum,
    typeTargetShare,
    typeTol,
    interactionCount,
    iTarget,
    iTol,
    terms: { archetype, glue, color, curve, interaction, power, type, fixingMultiplier, total },
  };
}

/**
 * Evaluate swapping `state.picks[outIdx]` for `inCard` (same bucket, enforced
 * by the caller — this module trusts it and doesn't re-check). Pure: does not
 * mutate `state`.
 *
 * `skipPower` reuses the state's CURRENT power term instead of re-sorting —
 * for ranking many candidates cheaply (refine.ts's wide per-iteration sample).
 * The result is then an approximation and must never be applied; refine.ts
 * re-evaluates the one candidate it actually picks with `skipPower` unset
 * before accepting or applying it.
 */
export function evalSwap(
  state: ScorerState,
  outIdx: number,
  inCard: CubeCard,
  skipPower = false
): SwapEval {
  const outCard = state.picks[outIdx].card;
  const outBucket = bucketOf(outCard);
  const outSlot = curveSlotOf(outCard.cmc);
  const inSlot = curveSlotOf(inCard.cmc);

  // ── archetype: only the ≤2 axes either card touches change at all ────────
  const outP = (outCard.synergyProducers ?? []).filter((a) => state.draftableSet.has(a));
  const outY = (outCard.synergyPayoffs ?? []).filter((a) => state.draftableSet.has(a));
  const inP = (inCard.synergyProducers ?? []).filter((a) => state.draftableSet.has(a));
  const inY = (inCard.synergyPayoffs ?? []).filter((a) => state.draftableSet.has(a));
  const touched = new Set<AxisKey>([...outP, ...outY, ...inP, ...inY]);
  const axisUpdates = new Map<AxisKey, { agg: AxisAgg; score: number }>();
  for (const ax of touched) {
    const cur = state.axisData.get(ax) ?? { e: 0, y: 0, buckets: {} };
    let e = cur.e;
    let y = cur.y;
    const buckets = { ...cur.buckets };
    const outTouches = outP.includes(ax) || outY.includes(ax);
    const inTouches = inP.includes(ax) || inY.includes(ax);
    if (outP.includes(ax)) e -= 1;
    if (outY.includes(ax)) y -= 1;
    if (inP.includes(ax)) e += 1;
    if (inY.includes(ax)) y += 1;
    // Same bucket in/out: a bucket-membership change only happens if one side
    // touches the axis and the other doesn't.
    if (outTouches && !inTouches) buckets[outBucket] = (buckets[outBucket] ?? 0) - 1;
    if (!outTouches && inTouches) buckets[outBucket] = (buckets[outBucket] ?? 0) + 1;
    const agg: AxisAgg = { e, y, buckets };
    axisUpdates.set(ax, { agg, score: axisScoreOf(ax, agg, state.minDepth) });
  }
  const archetype = archetypeFrom(
    state.draftable,
    state.k,
    (ax) => axisUpdates.get(ax)?.score ?? state.axisScore.get(ax) ?? 0
  );

  // ── glue ───────────────────────────────────────────────────────────────
  const glueSum = state.glueSum - glueScoreOf(outCard) + glueScoreOf(inCard);
  const glue = glueSum / state.pickCount;

  // ── color: constant (same-bucket swap never moves a WUBRG count) ─────────
  const color = state.terms.color;

  // ── curve ──────────────────────────────────────────────────────────────
  // Raw-sum bookkeeping (not `curve * 8` reversed) so repeated swaps don't
  // accumulate multiply/divide rounding error over a long climb.
  let curve = state.terms.curve;
  let curveFitSum = state.curveFitSum;
  let curveOut: SwapEval['curveOut'];
  let curveIn: SwapEval['curveIn'];
  if (outSlot !== inSlot) {
    const fillOut = state.curveFill[outSlot] - 1;
    const fillIn = state.curveFill[inSlot] + 1;
    const fitOut = fit(Math.abs(fillOut - state.curveTargetN[outSlot]), state.curveTol[outSlot]);
    const fitIn = fit(Math.abs(fillIn - state.curveTargetN[inSlot]), state.curveTol[inSlot]);
    curveFitSum = curveFitSum - state.curveFit[outSlot] - state.curveFit[inSlot] + fitOut + fitIn;
    curve = curveFitSum / CURVE_SLOTS.length;
    curveOut = { slot: outSlot, fill: fillOut, fitVal: fitOut };
    curveIn = { slot: inSlot, fill: fillIn, fitVal: fitIn };
  }

  // ── type ───────────────────────────────────────────────────────────────
  const outType = typeOf(outCard) as TypeSlot | null;
  const inType = typeOf(inCard) as TypeSlot | null;
  let type = state.terms.type;
  let typeFitSum = state.typeFitSum;
  let typeOutEv: SwapEval['typeOut'];
  let typeInEv: SwapEval['typeIn'];
  if (outType !== inType) {
    let sum = typeFitSum;
    if (outType) {
      const cnt = state.typeCount[outType] - 1;
      const f = fit(
        Math.abs(cnt / state.pickCount - state.typeTargetShare[outType]),
        state.typeTol[outType]
      );
      sum = sum - state.typeFit[outType] + f;
      typeOutEv = { slot: outType, count: cnt, fitVal: f };
    }
    if (inType) {
      const cnt = state.typeCount[inType] + 1;
      const f = fit(
        Math.abs(cnt / state.pickCount - state.typeTargetShare[inType]),
        state.typeTol[inType]
      );
      sum = sum - state.typeFit[inType] + f;
      typeInEv = { slot: inType, count: cnt, fitVal: f };
    }
    typeFitSum = sum;
    type = sum / TYPE_SLOTS.length;
  }

  // ── interaction ────────────────────────────────────────────────────────
  const outInteraction = outCard.role === 'removal' || outCard.role === 'boardwipe';
  const inInteraction = inCard.role === 'removal' || inCard.role === 'boardwipe';
  let interaction = state.terms.interaction;
  let interactionCount: number | undefined;
  if (outInteraction !== inInteraction) {
    const newCount = state.interactionCount + (inInteraction ? 1 : 0) - (outInteraction ? 1 : 0);
    interaction = fit(Math.abs(newCount / state.nonlandCount - state.iTarget), state.iTol);
    interactionCount = newCount;
  }

  // ── power: O(size) re-sort by design (see module header) ─────────────────
  // Skippable for ranking — see the `skipPower` doc above.
  let power = state.terms.power;
  if (!skipPower) {
    const cards = state.picks.map((p, i) => (i === outIdx ? inCard : p.card));
    power = powerTerm(cards, state.basis);
  }

  const fixingMultiplier = state.terms.fixingMultiplier; // constant: land untouched
  const weighted =
    state.weights.archetype * archetype +
    state.weights.glue * glue +
    state.weights.color * color +
    state.weights.curve * curve +
    state.weights.interaction * interaction +
    state.weights.power * power +
    state.weights.type * type;
  const total = fixingMultiplier * weighted;

  return {
    terms: { archetype, glue, color, curve, interaction, power, type, fixingMultiplier, total },
    axisUpdates,
    glueSum,
    curveFitSum,
    curveOut,
    curveIn,
    typeFitSum,
    typeOut: typeOutEv,
    typeIn: typeInEv,
    interactionCount,
  };
}

/**
 * Commit a previously-evaluated swap. Mutates `state` in place.
 *
 * Recomputes the power term itself (ignoring whatever `ev.terms.power` says)
 * so a caller that evaluated with `skipPower` for cheap ranking can never
 * commit a stale value by mistake — applySwap only ever runs once per
 * accepted iteration, so this O(size) re-sort is not on the hot path.
 */
export function applySwap(
  state: ScorerState,
  outIdx: number,
  inCard: CubeCard,
  bucket: ColorBucket,
  reason: string,
  ev: SwapEval
): void {
  state.picks[outIdx] = { card: inCard, bucket, reason };
  for (const [ax, upd] of ev.axisUpdates) {
    state.axisData.set(ax, upd.agg);
    state.axisScore.set(ax, upd.score);
  }
  state.glueSum = ev.glueSum;
  state.curveFitSum = ev.curveFitSum;
  if (ev.curveOut) {
    state.curveFill[ev.curveOut.slot] = ev.curveOut.fill;
    state.curveFit[ev.curveOut.slot] = ev.curveOut.fitVal;
  }
  if (ev.curveIn) {
    state.curveFill[ev.curveIn.slot] = ev.curveIn.fill;
    state.curveFit[ev.curveIn.slot] = ev.curveIn.fitVal;
  }
  state.typeFitSum = ev.typeFitSum;
  if (ev.typeOut) {
    state.typeCount[ev.typeOut.slot] = ev.typeOut.count;
    state.typeFit[ev.typeOut.slot] = ev.typeOut.fitVal;
  }
  if (ev.typeIn) {
    state.typeCount[ev.typeIn.slot] = ev.typeIn.count;
    state.typeFit[ev.typeIn.slot] = ev.typeIn.fitVal;
  }
  if (ev.interactionCount !== undefined) state.interactionCount = ev.interactionCount;

  const power = powerTerm(
    state.picks.map((p) => p.card),
    state.basis
  );
  const weighted =
    state.weights.archetype * ev.terms.archetype +
    state.weights.glue * ev.terms.glue +
    state.weights.color * ev.terms.color +
    state.weights.curve * ev.terms.curve +
    state.weights.interaction * ev.terms.interaction +
    state.weights.power * power +
    state.weights.type * ev.terms.type;
  state.terms = {
    ...ev.terms,
    power,
    total: ev.terms.fixingMultiplier * weighted,
  };
}

/** For the property test: the state's current terms as a `CubeScore`-shaped object (minus `axes`). */
export function currentTerms(state: ScorerState): ScoreTerms {
  return state.terms;
}
