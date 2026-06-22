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

import type { CubeCard, Pick } from './generate';
import { bucketOf, curveSlotOf } from './generate';
import type { BandTargets, ColorBucket, CurveSlot } from './targets';
import { AXES, type AxisKey } from '@/deck-builder/services/synergy/axes';

const WUBRG: ColorBucket[] = ['W', 'U', 'B', 'R', 'G'];
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

/** Term weights — sum to 1.0. Archetype is the lens the greedy ignores entirely. */
const W = {
  archetype: 0.4,
  glue: 0.15,
  color: 0.15,
  curve: 0.15,
  interaction: 0.1,
  power: 0.05,
} as const;

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
  glue: number;
  color: number;
  curve: number;
  interaction: number;
  power: number;
  /** Hard multiplier (0.75 or 1) — a fixing-starved cube is capped, not nudged. */
  fixingMultiplier: number;
  total: number;
  /** Activated axes, strongest support first (for the explainable UI). */
  axes: AxisSupport[];
}

const isLand = (c: CubeCard) => /\bland\b/i.test(c.typeLine);

/** Drafters per pod for a cube of this size (8-player pods cap the big cubes). */
function podSize(size: number): number {
  return Math.min(8, Math.max(4, Math.round(size / 45)));
}

/**
 * How many enabler+payoff pieces an archetype needs before it counts as "deep".
 * A floor of 12 keeps small cubes from rewarding 2-card "archetypes".
 */
function minDepth(size: number): number {
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
 * Composite power signal in [0, 1]: 60% pool-relative EDHREC rank + 40% mana
 * efficiency. Resolves the "popularity ≠ power" gap — a cheap, interactive,
 * flash card scores high on tempo even when its rank is middling, and a
 * rank-inflated 7-drop doesn't dominate. (EDHREC's `game_changer`/salt flags are
 * not populated in our offline bundle, so they're deliberately not used here.)
 */
export function rawPower(c: CubeCard, rankP80: number): number {
  const rankScore = 1 - Math.min(c.rank ?? rankP80, rankP80) / rankP80;
  const cmc = Math.max(0, c.cmc ?? 0);
  const tempo =
    Math.max(0, (4 - cmc) / 4) +
    (/\b(instant|flash)\b/i.test(c.typeLine) ? 0.15 : 0) +
    (c.role === 'removal' || c.role === 'cardDraw' ? 0.1 : 0);
  return 0.6 * rankScore + 0.4 * Math.min(1, tempo);
}

function contributes(c: CubeCard, ax: AxisKey): boolean {
  return (c.synergyProducers ?? []).includes(ax) || (c.synergyPayoffs ?? []).includes(ax);
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
 * `rankP80` is pool-constant — pass the precomputed value in hot loops (the
 * refiner does) to skip re-sorting the whole pool on every call.
 */
export function scoreCube(
  picks: Pick[],
  pool: CubeCard[],
  band: BandTargets,
  size: number,
  rankP80: number = computeRankP80(pool)
): CubeScore {
  const cards = picks.map((p) => p.card);
  const MIN_DEPTH = minDepth(size);

  const byBucket = {} as Record<ColorBucket, number>;
  for (const c of cards) {
    const b = bucketOf(c);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }
  const landCount = byBucket['land'] ?? 0;

  // ── Term A: archetype portfolio ─────────────────────────────────────────
  // Per-axis enabler/payoff tallies + a per-axis color-bucket distribution
  // (for the concentration factor).
  const axisData = new Map<
    AxisKey,
    { e: number; y: number; buckets: Record<ColorBucket, number> }
  >();
  const ensure = (ax: AxisKey) => {
    let d = axisData.get(ax);
    if (!d) {
      d = { e: 0, y: 0, buckets: {} as Record<ColorBucket, number> };
      axisData.set(ax, d);
    }
    return d;
  };
  for (const c of cards) {
    const b = bucketOf(c);
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
    }
  }

  const axisScoreOf = (
    ax: AxisKey,
    d: { e: number; y: number; buckets: Record<ColorBucket, number> }
  ) => {
    // M2 — cap blanket-gated enabler counts.
    const e = KEYWORD_GATED_AXES.has(ax) ? Math.min(d.e, 1.5 * MIN_DEPTH) : d.e;
    const y = d.y;
    const total = e + y;
    // M1 — symmetric balance: a payoff-only or enabler-only axis scores 0.
    // (Inside the ternary e>0 && y>0, so e + y ≥ 2 — no zero-divide guard needed.)
    const balance = e > 0 && y > 0 ? (2 * Math.min(e, y)) / (e + y) : 0;
    // M3 — concentration: reward an archetype packed into ≤2 colors over one
    // smeared across all five (which no single drafter can assemble).
    const bucketCounts = Object.values(d.buckets);
    const contribCount = bucketCounts.reduce((a, b) => a + b, 0);
    const top2 = [...bucketCounts]
      .sort((a, b) => b - a)
      .slice(0, 2)
      .reduce((a, b) => a + b, 0);
    const concentration = contribCount > 0 ? top2 / contribCount : 0;
    const depth = Math.min(total, MIN_DEPTH) / MIN_DEPTH;
    return depth * balance * (0.5 + 0.5 * concentration);
  };

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
  const draftable = draftablePoolAxes(pool);
  const axisScores = draftable
    .map((ax) => {
      const d = axisData.get(ax);
      return d ? axisScoreOf(ax, d) : 0;
    })
    .sort((a, b) => b - a);
  const k = Math.min(axisScores.length, targetArchetypeCount(size));
  const archetype = k > 0 ? axisScores.slice(0, k).reduce((s, v) => s + v, 0) / k : 1;

  // UI breakdown: the archetypes the cube actually fields, strongest first.
  const axes: AxisSupport[] = [];
  for (const [ax, d] of axisData) {
    if (d.e + d.y === 0) continue;
    axes.push({
      axis: ax,
      label: AXIS_LABEL.get(ax) ?? ax,
      enablers: d.e,
      payoffs: d.y,
      score: axisScoreOf(ax, d),
    });
  }

  // ── Term B: glue / overlap ──────────────────────────────────────────────
  // M7 — exclude spellslinger so every instant/sorcery doesn't inflate glue.
  const glueScore = (c: CubeCard) => {
    const p = (c.synergyProducers ?? []).filter((ax) => ax !== 'spellslinger').length;
    const y = (c.synergyPayoffs ?? []).length;
    return Math.min(p + y, 6) / 6;
  };
  const glue = cards.length ? cards.reduce((s, c) => s + glueScore(c), 0) / cards.length : 0;

  // ── Term C: color balance ───────────────────────────────────────────────
  // Share of ACTUAL picks (not target size) so an undersized cube that's
  // internally well-proportioned isn't penalized on every color.
  const pickCount = Math.max(1, cards.length);
  let colorSum = 0;
  for (const c of WUBRG) {
    const share = (byBucket[c] ?? 0) / pickCount;
    const t = band.color[c];
    const tol = Math.max(0.01, (t.p75 - t.p25) / 2);
    colorSum += Math.max(0, 1 - Math.abs(share - t.median) / tol);
  }
  const color = colorSum / WUBRG.length;

  // ── Term D: curve balance (over nonland cards) ──────────────────────────
  const nonland = cards.filter((c) => !isLand(c));
  const nlCount = nonland.length || 1;
  let curveSum = 0;
  for (const s of CURVE_SLOTS) {
    const fill = nonland.filter((c) => curveSlotOf(c.cmc) === s).length;
    const t = band.curve[s];
    const targetN = t.median * nlCount;
    const tol = Math.max(1, ((t.p75 - t.p25) * nlCount) / 2);
    curveSum += Math.max(0, 1 - Math.abs(fill - targetN) / tol);
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
  const interaction = Math.max(0, 1 - Math.abs(achieved - iTarget) / iTol);

  // ── Term F: power consistency ───────────────────────────────────────────
  // M8 — penalize a weak bottom decile, not high variance (so a few legit
  // high-CMC bombs that widen the band aren't ejected).
  const powers = cards.map((c) => rawPower(c, rankP80)).sort((a, b) => a - b);
  const p10 = powers.length ? powers[Math.floor((powers.length - 1) * 0.1)] : 1;
  const power = Math.max(0, 1 - 0.5 * Math.max(0, 0.35 - p10));

  // M6 — fixing adequacy is a hard cap, not a 0.028-gradient term that rounds
  // to noise. A catastrophically fixing-starved cube is capped at 75%.
  const fixingMultiplier = landCount < band.fixingLands.p25 * 0.5 ? 0.75 : 1;

  const weighted =
    W.archetype * archetype +
    W.glue * glue +
    W.color * color +
    W.curve * curve +
    W.interaction * interaction +
    W.power * power;
  const total = fixingMultiplier * weighted;

  axes.sort((a, b) => b.score - a.score || a.axis.localeCompare(b.axis));
  return { archetype, glue, color, curve, interaction, power, fixingMultiplier, total, axes };
}

export { contributes };
