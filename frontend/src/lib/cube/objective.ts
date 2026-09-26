// An explicit, scoreable objective function for "a good cube" — the thing the
// one-pass greedy fitter in ./generate can't optimize globally. Every term is
// normalized to [0, 1] and computed from real CubeCard fields + the mined
// per-size targets, so the weighted total is in [0, 1] and higher is strictly
// better. `refine.ts` hill-climbs this; `generate.ts` attaches the result so the
// UI can explain *which archetypes the cube actually supports*.
//
// Pure & deterministic: same picks + pool + size → same score (no Date/random).
//
// Design provenance: a multi-agent design pass (objective formulations → judge
// panel → adversary). The adversary mitigations are inline-commented (M#).

import type { Pick } from './generate';
import {
  bucketOf,
  curveSlotOf,
  isLand,
  pairOf,
  COLORS,
  type ColorPair,
  type CubeCard,
} from './core';
import type { BandTargets, ColorBucket, CurveSlot } from './targets';
import { AXES, type AxisKey } from '@/deck-builder/services/synergy/axes';

const CURVE_SLOTS: CurveSlot[] = ['0', '1', '2', '3', '4', '5', '6', '7'];
export const AXIS_LABEL = new Map<AxisKey, string>(AXES.map((a) => [a.key, a.label]));

/**
 * M2 — axes whose *producer* predicate is keyword/blanket-gated and over-fires
 * (e.g. the spellslinger patch tags every instant/sorcery as an enabler). Their
 * enabler counts are capped before scoring so a pile of cheap spells can't fake
 * deep archetype support.
 */
export const KEYWORD_GATED_AXES: ReadonlySet<AxisKey> = new Set<AxisKey>([
  'spellslinger',
  'equipment',
  'vehicles',
  'cycling',
  'energy',
  'auras',
  'poison',
  'superfriends',
]);

/**
 * Card-type buckets scored by term G, in mining precedence order (a card counts
 * toward its FIRST match, mirroring frontend/scripts/mine-cube-targets.mjs's
 * `TYPES.find`) — `land`/`battle` excluded: land density is already the color
 * term's job, and battle is ~0 in every real cube (mined p75 stays 0 at every
 * band), so scoring it adds noise, not signal.
 */
export const TYPE_SLOTS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
] as const;
const TYPE_CLASSIFY_ORDER = [...TYPE_SLOTS, 'land', 'battle'] as const;

export function typeOf(c: CubeCard): string | null {
  const t = c.typeLine.toLowerCase();
  return TYPE_CLASSIFY_ORDER.find((x) => t.includes(x)) ?? null;
}

/** Term weights — sum to 1.0. Archetype (+ its pair-concentration sibling) is
 *  the lens the greedy ignores entirely. */
const W = {
  archetype: 0.38,
  pairConcentration: 0.02,
  glue: 0.12,
  color: 0.13,
  curve: 0.13,
  interaction: 0.09,
  power: 0.05,
  type: 0.08,
} as const;
/** Combined weight of the two archetype-family terms — kept in one place so
 *  `weightsFor` scales and splits them together. */
const ARCHETYPE_FAMILY = W.archetype + W.pairConcentration;

/**
 * Term weights for a given synergy level (the "Best cards ↔ Synergy" slider).
 * At 1 these are `W` verbatim; below it the archetype-family weight (archetype
 * depth + pair concentration) shrinks and the freed weight spreads
 * proportionally across the environment terms — so sliding toward "Best cards"
 * makes the refiner care about curve/interaction/balance instead of theme
 * depth, rather than meaning nothing at all. Always sums to 1.
 */
export function weightsFor(synergyLevel: number): Record<keyof typeof W, number> {
  const family = ARCHETYPE_FAMILY * synergyLevel;
  const archetype = family * (W.archetype / ARCHETYPE_FAMILY);
  const pairConcentration = family - archetype;
  const k = (1 - family) / (1 - ARCHETYPE_FAMILY);
  return {
    archetype,
    pairConcentration,
    glue: W.glue * k,
    color: W.color * k,
    curve: W.curve * k,
    interaction: W.interaction * k,
    power: W.power * k,
    type: W.type * k,
  };
}

/**
 * How well an achieved value fits its corpus target, in (0, 1].
 *
 * Deliberately NEVER zero. The old `max(0, 1 - d/tol)` clamp created dead zones:
 * on a real collection the interaction term pinned at exactly 0.000, so the
 * hill-climbing refiner saw no gradient there and would freely cut the cube's
 * removal to feed an archetype — the cut cost nothing, because 0 can't go lower.
 * A rational falloff keeps a gradient everywhere while still penalizing hard:
 * on-target 1, one tolerance out 0.5, three out 0.1.
 *
 * Rational (multiply/divide only) rather than `Math.exp`, whose results are
 * implementation-defined — this module's contract is same-pool → same-cube on
 * every engine.
 */
export function fit(diff: number, tol: number): number {
  const r = diff / Math.max(tol, 1e-9);
  return 1 / (1 + r * r);
}

/** Draftability of one archetype axis within the cube. */
export interface AxisSupport {
  axis: AxisKey;
  label: string;
  enablers: number;
  payoffs: number;
  /** 0..1 — depth × enabler/payoff balance × color concentration. */
  score: number;
}

/** The objective broken into its named terms (all 0..1) plus the [0,1] total. */
export interface CubeScore {
  archetype: number;
  /** How well each of the cube's top archetypes concentrates its gold cards
   *  in the pair(s) that support it — see `pairConcentrationOf`. */
  pairConcentration: number;
  glue: number;
  color: number;
  curve: number;
  interaction: number;
  power: number;
  /** Type-shape fit (creature/instant/sorcery/artifact/enchantment/planeswalker vs corpus). */
  type: number;
  /** Hard multiplier (0.75 or 1) — a fixing-starved cube is capped, not nudged. */
  fixingMultiplier: number;
  total: number;
  /** Activated axes, strongest support first (for the explainable UI). */
  axes: AxisSupport[];
}

/** Drafters per pod for a cube of this size (8-player pods cap the big cubes). */
export function podSize(size: number): number {
  return Math.min(8, Math.max(4, Math.round(size / 45)));
}

/**
 * How many enabler+payoff pieces an archetype needs before it counts as "deep".
 * A floor of 12 keeps small cubes from rewarding 2-card "archetypes".
 */
export function minDepth(size: number): number {
  return Math.max(12, 2 * podSize(size));
}

/**
 * How many distinct archetypes a cube of this size should actually deliver. A
 * pod can only commit to so many lanes, so a good cube nails a focused handful
 * deeply rather than gesturing at every theme its collection could enable.
 * ~1.25 archetypes per drafter → a 4-player 180 aims for ~5, a full 8-player
 * cube ~10, matching how real cubes are built. The archetype term averages the
 * cube's best-K axis scores against this, so (correctly) ignoring the long tail
 * of unsupportable themes isn't penalized.
 */
export function targetArchetypeCount(size: number): number {
  return Math.round(1.25 * podSize(size));
}

/**
 * Rank value at the 80th percentile of the pool — the "good enough" floor used
 * to normalize EDHREC rank into a 0..1 power component. Pool-relative so a
 * budget collection isn't judged against a cEDH one.
 */
export function computeRankP80(pool: CubeCard[]): number {
  const ranks = pool
    .map((c) => c.rank)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
    .sort((a, b) => a - b);
  if (ranks.length === 0) return 5000; // no ranks at all → neutral floor
  const idx = Math.floor((ranks.length - 1) * 0.8); // P80, nearest-rank (0-indexed)
  return Math.max(1, ranks[idx]);
}

/**
 * Cube popularity at the 80th percentile of the pool — the "good enough" ceiling
 * that normalizes the cube signal into a 0..1 power component. Pool-relative for
 * the same reason as the rank floor. Cards without a signal don't count; a pool
 * with none at all gets 1 (every card then takes the rank fallback anyway).
 */
export function computePopP80(pool: CubeCard[]): number {
  const pops = pool
    .map((c) => c.cubePop)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    .sort((a, b) => b - a);
  if (pops.length === 0) return 1;
  const idx = Math.floor((pops.length - 1) * 0.2); // top-20% boundary = P80 of popularity
  return Math.max(0.01, pops[idx]);
}

/** Pool-constant normalizers for `rawPower` — compute once, pass into hot loops. */
export interface PowerBasis {
  popP80: number;
  rankP80: number;
}
export const computePowerBasis = (pool: CubeCard[]): PowerBasis => ({
  popP80: computePopP80(pool),
  rankP80: computeRankP80(pool),
});

/**
 * Composite power signal in [0, 1]: 60% pool-relative CUBE popularity + 40%
 * mana efficiency. Resolves the "popularity ≠ power" gap — a cheap, interactive,
 * flash card scores high on tempo even when its signal is middling, and a
 * signal-inflated 7-drop doesn't dominate. A card CubeCobra has never seen falls
 * back to pool-relative EDHREC rank at HALF credit: unproven in a cube, not
 * bad. (EDHREC's `game_changer`/salt flags are not populated in our offline
 * bundle, so they're deliberately not used here.)
 */
export function rawPower(c: CubeCard, basis: PowerBasis): number {
  const { popP80, rankP80 } = basis;
  const signalScore =
    c.cubePop != null
      ? Math.min(c.cubePop, popP80) / popP80
      : 0.5 * (1 - Math.min(c.rank ?? rankP80, rankP80) / rankP80);
  const cmc = Math.max(0, c.cmc ?? 0);
  const tempo =
    Math.max(0, (4 - cmc) / 4) +
    (/\b(instant|flash)\b/i.test(c.typeLine) ? 0.15 : 0) +
    (c.role === 'removal' || c.role === 'cardDraw' ? 0.1 : 0);
  return 0.6 * signalScore + 0.4 * Math.min(1, tempo);
}

function contributes(c: CubeCard, ax: AxisKey): boolean {
  return (c.synergyProducers ?? []).includes(ax) || (c.synergyPayoffs ?? []).includes(ax);
}

/** Per-axis enabler/payoff/bucket/pair tally, as accumulated in `scoreCube` and (incrementally) in ./scorer-state. */
export interface AxisAgg {
  e: number;
  y: number;
  buckets: Partial<Record<ColorBucket, number>>;
  /** Same tally, but only for exactly-two-color (gold) contributors, keyed by
   *  their `ColorPair` — the basis for `pairConcentrationOf`. A mono/colorless
   *  or 3+ color contributor touches `buckets` above but not this. */
  pairs: Partial<Record<ColorPair, number>>;
}

/**
 * One archetype axis's 0..1 support score from its tallied enabler/payoff/bucket
 * counts — M1 (symmetric balance), M2 (keyword-gated enabler cap), M3 (color
 * concentration). Pulled out of `scoreCube` so ./scorer-state can recompute just
 * the touched axes on a swap instead of re-tallying the whole cube.
 */
export function axisScoreOf(ax: AxisKey, d: AxisAgg, minDepthVal: number): number {
  const e = KEYWORD_GATED_AXES.has(ax) ? Math.min(d.e, 1.5 * minDepthVal) : d.e;
  const y = d.y;
  const total = e + y;
  const balance = e > 0 && y > 0 ? (2 * Math.min(e, y)) / (e + y) : 0;
  const bucketCounts = Object.values(d.buckets);
  const contribCount = bucketCounts.reduce((a, b) => a + b, 0);
  const top2 = [...bucketCounts]
    .sort((a, b) => b - a)
    .slice(0, 2)
    .reduce((a, b) => a + b, 0);
  const concentration = contribCount > 0 ? top2 / contribCount : 0;
  const depth = Math.min(total, minDepthVal) / minDepthVal;
  return depth * balance * (0.5 + 0.5 * concentration);
}

/**
 * Below this many gold contributors, "concentration" isn't a measurement, it's
 * noise: 1 gold card is trivially 100% concentrated, 2-3 cards swing wildly
 * (50%-100%) on a single swap. Scoring that swing gave the refiner a strong,
 * volatile gradient at exactly the cube sizes where gold-per-pair is naturally
 * thin (a handful of cards per pair at 180-360) — measured dragging archetype
 * down further on top of the seed-shape cost `selectMulticolorBucket` already
 * pays for pair balance. A real, deep archetype has plenty of gold
 * contributors; this floor costs it nothing.
 */
const MIN_GOLD_SAMPLE = 4;

/**
 * How much one archetype's gold (exactly-two-color) contributors concentrate
 * in a SINGLE pair, in (0, 1] — 1 = every gold card shares one identity (a
 * real cube's "UB = reanimator"), lower = the theme's gold pieces are spread
 * across unrelated pairs, which is undraftable ("half your reanimator payoffs
 * are UB, half are RW"). Top-1 share of gold contributors, not top-2 like
 * `axisScoreOf`'s bucket concentration: spreading over TWO pairs is exactly
 * the failure this term exists to catch, where spreading a mono-color theme
 * over "U" and "multicolor" (axisScoreOf's coarser buckets) is not a defect.
 * An axis with fewer than `MIN_GOLD_SAMPLE` gold contributors — including none
 * at all (a purely mono-color theme) — has nothing MEANINGFUL to concentrate
 * yet: scores 1, M4-style, so it isn't penalized for a property that doesn't
 * apply to it (or that a thin sample can't reliably measure).
 */
export function pairConcentrationOf(d: AxisAgg): number {
  const counts = Object.values(d.pairs);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < MIN_GOLD_SAMPLE) return 1;
  return Math.max(...counts) / total;
}

/**
 * Rank `draftable` axes by `primary`, average the top-`k` `primary` values
 * (the metric `k` was computed for), and separately average `secondary` over
 * that SAME top-k set — used so the archetype term and the pair-concentration
 * term always judge the cube's same K "real" archetypes (the ones deep enough
 * to matter), rather than pair-concentration picking its own, unrelated top-k
 * (which would let two stray same-pair gold cards on an otherwise-empty axis
 * outscore a cube's actual best archetype). `k === 0` (nothing draftable) is
 * M4: nothing to penalize, both terms are 1.
 */
export function topKMean(
  draftable: AxisKey[],
  k: number,
  primary: (ax: AxisKey) => number,
  secondary: (ax: AxisKey) => number
): { primary: number; secondary: number } {
  if (k === 0) return { primary: 1, secondary: 1 };
  const ranked = draftable
    .map((ax) => ({ ax, v: primary(ax) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, k);
  return {
    primary: ranked.reduce((s, r) => s + r.v, 0) / k,
    secondary: ranked.reduce((s, r) => s + secondary(r.ax), 0) / k,
  };
}

/** Term B (glue/overlap) for one card. M7 — spellslinger excluded so every instant/sorcery doesn't inflate it. */
export function glueScoreOf(c: CubeCard): number {
  const p = (c.synergyProducers ?? []).filter((ax) => ax !== 'spellslinger').length;
  const y = (c.synergyPayoffs ?? []).length;
  return Math.min(p + y, 6) / 6;
}

/**
 * Term F (power consistency) over a set of cards — M8, penalize a weak bottom
 * decile rather than high variance. Pulled out of `scoreCube` so ./scorer-state
 * can recompute it (the one term left as an O(size) re-sort by design — see
 * that module's header) without duplicating the formula.
 */
export function powerTerm(cards: CubeCard[], basis: PowerBasis): number {
  const powers = cards.map((c) => rawPower(c, basis)).sort((a, b) => a - b);
  const p10 = powers.length ? powers[Math.floor((powers.length - 1) * 0.1)] : 1;
  return Math.max(0, 1 - 0.5 * Math.max(0, 0.35 - p10));
}

/**
 * Axes the owned pool can actually make draftable — it has BOTH an enabler and a
 * payoff somewhere. These are the baseline the archetype term scores against: a
 * cube that fails to draft an archetype its collection *can* support scores low,
 * while a genuinely tag-less pool has nothing to support and isn't penalized
 * (M4). Also the set the refiner optimizes toward.
 */
export function draftablePoolAxes(pool: CubeCard[]): AxisKey[] {
  const producers = new Set<AxisKey>();
  const payoffs = new Set<AxisKey>();
  for (const c of pool) {
    for (const a of c.synergyProducers ?? []) producers.add(a);
    for (const a of c.synergyPayoffs ?? []) payoffs.add(a);
  }
  return AXES.map((a) => a.key).filter((k) => producers.has(k) && payoffs.has(k));
}

/**
 * Score a cube. Pure; safe to call on every candidate during refinement.
 * `basis` is pool-constant — pass the precomputed value in hot loops (the
 * refiner does) to skip re-sorting the whole pool on every call.
 */
export function scoreCube(
  picks: Pick[],
  pool: CubeCard[],
  band: BandTargets,
  size: number,
  basis: PowerBasis = computePowerBasis(pool),
  synergyLevel = 1
): CubeScore {
  const cards = picks.map((p) => p.card);
  const MIN_DEPTH = minDepth(size);

  const byBucket = {} as Record<ColorBucket, number>;
  for (const c of cards) {
    const b = bucketOf(c);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }
  const landCount = byBucket['land'] ?? 0;

  // ── Term A: archetype portfolio (+ Term A2: pair concentration) ──────────
  // Per-axis enabler/payoff tallies + a per-axis color-bucket distribution
  // (for the concentration factor) + a per-axis color-PAIR distribution over
  // just its gold contributors (for the pair-concentration term).
  const axisData = new Map<AxisKey, AxisAgg>();
  const ensure = (ax: AxisKey) => {
    let d = axisData.get(ax);
    if (!d) {
      d = { e: 0, y: 0, buckets: {}, pairs: {} };
      axisData.set(ax, d);
    }
    return d;
  };
  for (const c of cards) {
    const b = bucketOf(c);
    const p = pairOf(c);
    const touched = new Set<AxisKey>();
    for (const ax of c.synergyProducers ?? []) {
      ensure(ax).e++;
      touched.add(ax);
    }
    for (const ax of c.synergyPayoffs ?? []) {
      ensure(ax).y++;
      touched.add(ax);
    }
    for (const ax of touched) {
      const d = ensure(ax);
      d.buckets[b] = (d.buckets[b] ?? 0) + 1;
      if (p) d.pairs[p] = (d.pairs[p] ?? 0) + 1;
    }
  }

  // Archetype term: how well the cube drafts the archetypes its COLLECTION can
  // support. Absent-but-draftable axes score 0 (the cube failed to build them);
  // a tag-less pool has no draftable axes → 1.0 (M4, nothing to penalize).
  // Score the cube's BEST-supported archetypes, not every theme its collection
  // could enable. Averaging over ALL draftable axes punishes a focused cube for
  // (correctly) ignoring archetypes no pod this size can draft — so a 12k-card
  // collection that can support ~20 themes drags the term toward 0 no matter how
  // well the cube nails its 5. Instead average the top-K axis scores, K = what a
  // cube this size should deliver. A pool supporting fewer than K axes uses all
  // of them, so sparse/tag-less pools are unchanged (M4 still holds: 0 → 1).
  //
  // Pair concentration rides along on the SAME top-K axes (see `topKMean`) — a
  // real cube's "UB = reanimator, RW = aggro" shape only means something for
  // the archetypes the cube actually delivers.
  const draftable = draftablePoolAxes(pool);
  const k = Math.min(draftable.length, targetArchetypeCount(size));
  const { primary: archetype, secondary: pairConcentration } = topKMean(
    draftable,
    k,
    (ax) => {
      const d = axisData.get(ax);
      return d ? axisScoreOf(ax, d, MIN_DEPTH) : 0;
    },
    (ax) => {
      const d = axisData.get(ax);
      return d ? pairConcentrationOf(d) : 1;
    }
  );

  // UI breakdown: the archetypes the cube actually fields, strongest first.
  const axes: AxisSupport[] = [];
  for (const [ax, d] of axisData) {
    if (d.e + d.y === 0) continue;
    axes.push({
      axis: ax,
      label: AXIS_LABEL.get(ax) ?? ax,
      enablers: d.e,
      payoffs: d.y,
      score: axisScoreOf(ax, d, MIN_DEPTH),
    });
  }

  // ── Term B: glue / overlap ──────────────────────────────────────────────
  // M7 — exclude spellslinger so every instant/sorcery doesn't inflate glue.
  const glue = cards.length ? cards.reduce((s, c) => s + glueScoreOf(c), 0) / cards.length : 0;

  // ── Term C: color balance ───────────────────────────────────────────────
  // Share of ACTUAL picks (not target size) so an undersized cube that's
  // internally well-proportioned isn't penalized on every color.
  const pickCount = Math.max(1, cards.length);
  let colorSum = 0;
  for (const c of COLORS) {
    const share = (byBucket[c] ?? 0) / pickCount;
    const t = band.color[c];
    const tol = Math.max(0.01, (t.p75 - t.p25) / 2);
    colorSum += fit(Math.abs(share - t.median), tol);
  }
  const color = colorSum / COLORS.length;

  // ── Term D: curve balance (over nonland cards) ──────────────────────────
  const nonland = cards.filter((c) => !isLand(c));
  const nlCount = nonland.length || 1;
  let curveSum = 0;
  for (const s of CURVE_SLOTS) {
    const fill = nonland.filter((c) => curveSlotOf(c.cmc) === s).length;
    const t = band.curve[s];
    const targetN = t.median * nlCount;
    const tol = Math.max(1, ((t.p75 - t.p25) * nlCount) / 2);
    curveSum += fit(Math.abs(fill - targetN), tol);
  }
  const curve = curveSum / CURVE_SLOTS.length;

  // ── Term E: interaction density ─────────────────────────────────────────
  // M5 — role targets are fractions of NONLAND cards, so divide by the actual
  // nonland pick count (same basis as the curve term — not target size, which
  // would deflate the ratio when the collection is short of `size`).
  const nonlandCount = Math.max(1, nonland.length);
  const interactionCount = cards.filter(
    (c) => c.role === 'removal' || c.role === 'boardwipe'
  ).length;
  const achieved = interactionCount / nonlandCount;
  const iTarget = band.role.removal.median + band.role.boardwipe.median;
  const iP25 = band.role.removal.p25 + band.role.boardwipe.p25;
  const iP75 = band.role.removal.p75 + band.role.boardwipe.p75;
  const iTol = Math.max(0.01, (iP75 - iP25) / 2);
  const interaction = fit(Math.abs(achieved - iTarget), iTol);

  // ── Term G: type shape ──────────────────────────────────────────────────
  // Same basis as color (term C): band.type is mined as a share of ALL cards,
  // land included (see mine-cube-targets.mjs), so score against actual total
  // picks — not nonland count (curve/interaction's basis) and not target size.
  // This is what gives the refiner a reason to stop swapping creatures for
  // archetype/interaction picks: without it, type has no gradient at all, so a
  // swap that helps every other term is free to erode creature share with no
  // cost — measured on a real pool, refinement alone drove it from 44% to 41%.
  let typeSum = 0;
  for (const t of TYPE_SLOTS) {
    const count = cards.filter((c) => typeOf(c) === t).length;
    const share = count / pickCount;
    const tgt = band.type[t];
    const tol = Math.max(0.01, (tgt.p75 - tgt.p25) / 2);
    typeSum += fit(Math.abs(share - tgt.median), tol);
  }
  const type = typeSum / TYPE_SLOTS.length;

  // ── Term F: power consistency ───────────────────────────────────────────
  // M8 — penalize a weak bottom decile, not high variance (so a few legit
  // high-CMC bombs that widen the band aren't ejected).
  const power = powerTerm(cards, basis);

  // M6 — fixing adequacy is a hard cap, not a 0.028-gradient term that rounds
  // to noise. A catastrophically fixing-starved cube is capped at 75%.
  const fixingMultiplier = landCount < band.fixingLands.p25 * 0.5 ? 0.75 : 1;

  const w = weightsFor(synergyLevel);
  const weighted =
    w.archetype * archetype +
    w.pairConcentration * pairConcentration +
    w.glue * glue +
    w.color * color +
    w.curve * curve +
    w.interaction * interaction +
    w.power * power +
    w.type * type;
  const total = fixingMultiplier * weighted;

  axes.sort((a, b) => b.score - a.score || a.axis.localeCompare(b.axis));
  return {
    archetype,
    pairConcentration,
    glue,
    color,
    curve,
    interaction,
    power,
    type,
    fixingMultiplier,
    total,
    axes,
  };
}

export { contributes };
