// Build a singleton cube from a pool of owned cards, shaped toward the
// empirical per-size targets in ./targets (derived from real popular cubes).
//
// Philosophy (from luckypaper.co/articles/building-a-cube-from-a-collection):
// there is no perfect formula. We take your best owned cards and edit toward
// what good cubes of this size actually look like — then tell you exactly where
// your collection can't reach the template, because that gap IS the answer.
//
// Pure & deterministic: same pool + size → same cube. UI adapts the collection
// into CubeCard[]; this module does the selection and the explanation.

import { CubeSize, ColorBucket, CurveSlot, Role, targetsForSize, BandTargets } from './targets';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import type { CubeScore } from './objective';
import { AXIS_LABEL } from './objective';
import { refineCube } from './refine';

export interface CubeCard {
  name: string;
  oracleId: string;
  colors: string[]; // [] = colorless
  cmc: number;
  typeLine: string;
  role: Role | null; // precomputed via the shared tagger
  rank?: number; // edhrecRank — lower is more-played; undefined = unknown
  synergyProducers?: AxisKey[]; // archetype axes this card enables (see synergy-tags)
  synergyPayoffs?: AxisKey[]; // archetype axes this card pays off
}

/** One selected card plus the slot it was picked to fill (the "why"). */
export interface Pick {
  card: CubeCard;
  bucket: ColorBucket;
  reason: string;
}

export interface Gap {
  severity: 'short' | 'note';
  text: string;
}

export interface GeneratedCube {
  size: CubeSize;
  picks: Pick[];
  /** Achieved count per color bucket (what we actually selected). */
  byBucket: Record<ColorBucket, number>;
  /** Target count per color bucket (what good cubes run). */
  targetByBucket: Record<ColorBucket, number>;
  gaps: Gap[];
  /** How many slots we couldn't fill from the owned pool (cube smaller than size). */
  shortfall: number;
  poolSize: number;
  /**
   * The objective score for this cube (archetype/balance/power breakdown, 0..1).
   * Always computed; absent only on cubes saved before the objective shipped.
   */
  score?: CubeScore;
}

/** Optional knobs for cube generation. */
export interface CubeGenOptions {
  /**
   * 0 = pure goodstuff by EDHREC rank, unrefined (byte-for-byte, no score).
   * Above 0 the objective-driven refiner runs, and the level sets how much of
   * the objective's weight sits on archetype depth vs. a balanced draft
   * environment (curve, interaction, color) — see `weightsFor` in ./objective.
   */
  synergyLevel?: number;
}

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const BUCKETS: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'];
const COLOR_NAME: Record<ColorBucket, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  multicolor: 'Multicolor',
  colorless: 'Colorless',
  land: 'Lands',
};
const ROLE_NAME: Record<Role, string> = {
  removal: 'removal',
  boardwipe: 'board wipes',
  ramp: 'ramp',
  cardDraw: 'card draw',
};

export const isLand = (c: CubeCard) => /\bland\b/i.test(c.typeLine);
const isBasic = (c: CubeCard) => /basic/i.test(c.typeLine) && isLand(c);

export function bucketOf(c: CubeCard): ColorBucket {
  if (isLand(c)) return 'land';
  const colors = c.colors.filter((x) => COLORS.includes(x as (typeof COLORS)[number]));
  if (colors.length === 0) return 'colorless';
  if (colors.length > 1) return 'multicolor';
  return colors[0] as ColorBucket;
}

export function curveSlotOf(cmc: number): CurveSlot {
  return String(Math.min(7, Math.max(0, Math.round(cmc || 0)))) as CurveSlot;
}

/** quality: lower edhrecRank = better; unknown rank sorts last. oracleId breaks
 *  ties so every sort (and thus the whole cube) is deterministic regardless of
 *  the pool's incoming order. */
export const byQuality = (a: CubeCard, b: CubeCard) =>
  (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.oracleId.localeCompare(b.oracleId);

/** Largest-remainder apportionment so bucket targets sum exactly to `size`. */
function apportion(shares: Record<ColorBucket, number>, size: number): Record<ColorBucket, number> {
  const exact = BUCKETS.map((b) => ({ b, v: shares[b] * size }));
  const floored = exact.map((e) => ({ ...e, f: Math.floor(e.v), r: e.v - Math.floor(e.v) }));
  let used = floored.reduce((s, e) => s + e.f, 0);
  const out = {} as Record<ColorBucket, number>;
  for (const e of floored) out[e.b] = e.f;
  // Tiebreak equal remainders by fixed BUCKETS order so apportionment is
  // deterministic across JS engines (honors the module's same-pool→same-cube contract).
  for (const e of [...floored].sort(
    (x, y) => y.r - x.r || BUCKETS.indexOf(x.b) - BUCKETS.indexOf(y.b)
  )) {
    if (used >= size) break;
    out[e.b]++;
    used++;
  }
  return out;
}

type AxisCount = { producers: number; payoffs: number };

/** Per-axis enabler/payoff tallies across a set of cards. */
function countAxes(cards: CubeCard[]): Map<AxisKey, AxisCount> {
  const counts = new Map<AxisKey, AxisCount>();
  const bump = (k: AxisKey, side: keyof AxisCount) => {
    const cur = counts.get(k) ?? { producers: 0, payoffs: 0 };
    cur[side]++;
    counts.set(k, cur);
  };
  for (const c of cards) {
    for (const k of c.synergyProducers ?? []) bump(k, 'producers');
    for (const k of c.synergyPayoffs ?? []) bump(k, 'payoffs');
  }
  return counts;
}

/** Select up to `target` cards from a bucket pool, shaping toward curve & role sub-targets. */
function selectBucket(
  pool: CubeCard[],
  target: number,
  band: BandTargets,
  isLandBucket: boolean
): { picks: CubeCard[]; deferred: CubeCard[] } {
  const sorted = [...pool].sort(byQuality);
  if (isLandBucket || sorted.length <= target) {
    // Lands: quality-only (fixing nuance isn't worth a Scryfall round-trip here).
    return { picks: sorted.slice(0, target), deferred: sorted.slice(target) };
  }

  const curveCap: Record<CurveSlot, number> = {} as Record<CurveSlot, number>;
  const curveFill: Record<CurveSlot, number> = {} as Record<CurveSlot, number>;
  for (let s = 0; s <= 7; s++) {
    curveCap[String(s) as CurveSlot] = Math.ceil(
      band.curve[String(s) as CurveSlot].median * target
    );
    curveFill[String(s) as CurveSlot] = 0;
  }
  const roleTarget: Record<Role, number> = {
    removal: Math.round(band.role.removal.median * target),
    boardwipe: Math.round(band.role.boardwipe.median * target),
    ramp: Math.round(band.role.ramp.median * target),
    cardDraw: Math.round(band.role.cardDraw.median * target),
  };
  const roleFill: Record<Role, number> = { removal: 0, boardwipe: 0, ramp: 0, cardDraw: 0 };

  const picks: CubeCard[] = [];
  const deferred: CubeCard[] = [];
  const take = (card: CubeCard) => {
    picks.push(card);
    curveFill[curveSlotOf(card.cmc)]++;
    if (card.role) roleFill[card.role]++;
  };

  // Fill slots by quality, shaping toward curve & role sub-targets.
  for (const card of sorted) {
    if (picks.length >= target) {
      deferred.push(card);
      continue;
    }
    const slot = curveSlotOf(card.cmc);
    const fillsCurve = curveFill[slot] < curveCap[slot];
    const fillsRole = card.role != null && roleFill[card.role] < roleTarget[card.role];
    if (fillsCurve || fillsRole) {
      take(card);
    } else {
      deferred.push(card);
    }
  }
  // If curve caps left us short, backfill from deferred (still quality-ordered).
  while (picks.length < target && deferred.length) {
    picks.push(deferred.shift()!);
  }
  return { picks, deferred };
}

function reasonFor(c: CubeCard, bucket: ColorBucket): string {
  if (bucket === 'land') return 'Fixing / utility land';
  const base = COLOR_NAME[bucket];
  if (c.role) return `${base} · ${ROLE_NAME[c.role]}`;
  const slot = curveSlotOf(c.cmc);
  return `${base} · ${slot === '7' ? '7+' : slot}-drop`;
}

export function generateCube(
  rawPool: CubeCard[],
  size: CubeSize,
  options?: CubeGenOptions
): GeneratedCube {
  const band = targetsForSize(size);
  const synergyLevel = Math.max(0, Math.min(1, options?.synergyLevel ?? 0));

  // Singleton, no basics. Dedupe by oracleId keeping the best-ranked copy.
  const byOracle = new Map<string, CubeCard>();
  for (const c of rawPool) {
    if (isBasic(c)) continue;
    const key = c.oracleId || c.name.toLowerCase();
    const prev = byOracle.get(key);
    if (!prev || byQuality(c, prev) < 0) byOracle.set(key, c);
  }
  const pool = [...byOracle.values()];

  // Bucket the pool.
  const buckets = {} as Record<ColorBucket, CubeCard[]>;
  for (const b of BUCKETS) buckets[b] = [];
  for (const c of pool) buckets[bucketOf(c)].push(c);

  // Target count per bucket (empirical color shares; land uses the fixing-land target).
  const shares = {} as Record<ColorBucket, number>;
  for (const b of BUCKETS) shares[b] = band.color[b].median;
  const targetByBucket = apportion(shares, size);

  // Select per bucket, capping at what's owned.
  const picks: Pick[] = [];
  const byBucket = {} as Record<ColorBucket, number>;
  const leftovers: CubeCard[] = [];
  for (const b of BUCKETS) {
    const want = Math.min(targetByBucket[b], buckets[b].length);
    const { picks: sel, deferred } = selectBucket(buckets[b], want, band, b === 'land');
    byBucket[b] = sel.length;
    for (const c of sel) picks.push({ card: c, bucket: b, reason: reasonFor(c, b) });
    leftovers.push(...deferred);
  }

  // Backfill toward `size` from the best leftover cards (collection light in some
  // colors → still ship a full-size cube, but flag the imbalance below).
  let shortfall = 0;
  const filled = picks.length;
  if (filled < size) {
    const need = size - filled;
    const extra = leftovers.sort(byQuality).slice(0, need);
    for (const c of extra) {
      const b = bucketOf(c);
      byBucket[b]++;
      picks.push({ card: c, bucket: b, reason: reasonFor(c, b) });
    }
    shortfall = Math.max(0, size - picks.length);
  }

  // Archetype gaps reflect the owned COLLECTION's capacity (not how dense the
  // slider made this cube), and only show once the user engages synergy — so
  // the default goodstuff experience stays unchanged.
  const poolAxes = synergyLevel > 0 ? countAxes(pool) : null;
  const gaps = buildGaps(byBucket, band, size, pool.length, shortfall, poolAxes);

  // Engaging the slider turns on the objective-driven refiner: hill-climb the
  // greedy seed toward a better cube, and attach the objective score so the UI
  // can explain what the cube supports. Swaps stay in-bucket, so byBucket (and
  // the color/fixing/archetype gaps above) are unchanged — only which cards fill
  // each bucket improves. `synergyLevel` sets how much of the objective's weight
  // sits on archetype depth vs. a well-balanced environment, which is exactly
  // what the "Best cards ↔ Synergy" slider promises. synergyLevel 0 keeps the
  // byte-for-byte goodstuff cube with no score.
  //
  // The refiner is the ONLY archetype mechanism. An earlier design also reserved
  // per-axis slots before the greedy shaped curve/roles; measured against the
  // objective on a real 2.6k-card pool it was net-negative at every size (360:
  // 0.632 refiner-only vs 0.470 with the reserve) — it wrecked curve and ate the
  // cube's removal for no archetype gain at all (0.457 → 0.456), because the
  // reserve pre-empts slots the greedy needs for shape. Deleted; don't reinstate
  // without an A/B on a real pool.
  let finalPicks = picks;
  let finalByBucket = byBucket;
  let score: CubeScore | undefined;
  if (synergyLevel > 0) {
    const refined = refineCube(
      { size, picks, byBucket, targetByBucket, gaps, shortfall, poolSize: pool.length },
      pool,
      band,
      size,
      synergyLevel
    );
    finalPicks = refined.picks;
    finalByBucket = refined.byBucket;
    score = refined.score;
  }
  return {
    size,
    picks: finalPicks,
    byBucket: finalByBucket,
    targetByBucket,
    gaps,
    shortfall,
    poolSize: pool.length,
    score,
  };
}

function buildGaps(
  got: Record<ColorBucket, number>,
  band: BandTargets,
  size: number,
  poolSize: number,
  shortfall: number,
  poolAxes?: Map<AxisKey, AxisCount> | null
): Gap[] {
  const gaps: Gap[] = [];

  if (shortfall > 0) {
    gaps.push({
      severity: 'short',
      text: `You own ${poolSize} non-basic singles — ${shortfall} short of a ${size}-card cube. Import more of your collection, or pick a smaller size.`,
    });
  }

  // Color balance: a color whose share falls below the corpus p25 is genuinely light.
  for (const c of COLORS) {
    const share = got[c] / size;
    if (share < band.color[c].p25) {
      gaps.push({
        severity: 'short',
        text: `Light on ${COLOR_NAME[c]} (${Math.round(share * 100)}% vs the ${Math.round(
          band.color[c].p25 * 100
        )}–${Math.round(band.color[c].p75 * 100)}% real ${size}-card cubes run) — you own fewer good ${COLOR_NAME[
          c
        ].toLowerCase()} cards than the template wants.`,
      });
    }
  }

  // Fixing: nonbasic land count vs corpus.
  if (got.land < band.fixingLands.p25) {
    gaps.push({
      severity: 'short',
      text: `Only ${got.land} fixing lands — good ${size}-card cubes run ${Math.round(
        band.fixingLands.p25
      )}–${Math.round(band.fixingLands.p75)}. Drafters may struggle to cast multicolor cards.`,
    });
  }

  // Archetype support: does the COLLECTION have the enabler/payoff density a
  // draftable archetype needs? Thresholds scale from the cube-design rule of
  // thumb (~12 enablers / ~6 payoffs per 360) by size.
  if (poolAxes && poolAxes.size) {
    const enablerFloor = Math.max(3, Math.round((12 * size) / 360));
    const payoffFloor = Math.max(2, Math.round((6 * size) / 360));
    const total = (n: AxisCount) => n.producers + n.payoffs;
    // Axes the collection genuinely leans into, strongest first.
    const candidates = [...poolAxes.entries()]
      .filter(([, n]) => total(n) >= enablerFloor)
      // Axis-key tiebreak so equal-depth axes report deterministically (the
      // Map's order otherwise follows pool-input order).
      .sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]));

    // Celebrate the deepest well-supported archetype.
    const strong = candidates.find(
      ([, n]) => n.producers >= enablerFloor && n.payoffs >= payoffFloor
    );
    if (strong) {
      const [axis, n] = strong;
      gaps.push({
        severity: 'note',
        text: `Strong ${AXIS_LABEL.get(axis) ?? axis} support — ${n.producers} enablers / ${n.payoffs} payoffs in your collection. Slide toward Synergy to lean in.`,
      });
    }

    // Flag up to two archetypes the collection reaches for but can't fill.
    let reported = 0;
    for (const [axis, n] of candidates) {
      if (reported >= 2) break;
      const label = AXIS_LABEL.get(axis) ?? axis;
      if (n.payoffs === 0) {
        gaps.push({
          severity: 'short',
          text: `${label}: ${n.producers} enablers but no payoff in your collection — fuel with nothing to cash it in. Add payoff cards to make it draftable.`,
        });
        reported++;
      } else if (n.producers < enablerFloor || n.payoffs < payoffFloor) {
        gaps.push({
          severity: 'short',
          text: `${label}: ${n.producers} enablers / ${n.payoffs} payoffs — thin for a draftable archetype (good ${size}-card cubes want ~${enablerFloor} / ~${payoffFloor}). More in your collection would deepen it.`,
        });
        reported++;
      }
    }
  }

  // A short, positive note on what the cube does well (balance is the headline metric).
  const spread = COLORS.map((c) => got[c]);
  const min = Math.min(...spread);
  const max = Math.max(...spread);
  if (max > 0 && min / max >= 0.85 && shortfall === 0) {
    gaps.push({
      severity: 'note',
      text: 'Colors are evenly balanced — the hallmark of a well-built cube.',
    });
  }

  return gaps;
}
