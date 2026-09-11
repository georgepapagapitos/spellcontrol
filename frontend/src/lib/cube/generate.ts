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
import { COLORS, isLand, bucketOf, curveSlotOf, type CubeCard } from './core';

// The card shape and the pure classifiers live in ./core so `objective` and
// `refine` can reach them without importing back up into this module — that
// was a value-level import cycle. Re-exported here so every existing
// `from './cube/generate'` import site keeps working unchanged.
export { COLORS, isLand, bucketOf, curveSlotOf } from './core';
export type { CubeCard } from './core';

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

const isBasic = (c: CubeCard) => /basic/i.test(c.typeLine) && isLand(c);

/** quality: the cube-native signal first — higher CubeCobra popularity (share
 *  of cubes holding the card), then higher draft Elo — and EDHREC rank only for
 *  cards CubeCobra has never seen, which sort after every cubed card (lower rank
 *  = better; unknown last). EDHREC rank alone is Commander popularity: it put
 *  Command Tower and Arcane Signet at the top of a draft cube's colorless
 *  section (E288). oracleId breaks ties so every sort (and thus the whole cube)
 *  is deterministic regardless of the pool's incoming order. */
export const byQuality = (a: CubeCard, b: CubeCard) =>
  (b.cubePop ?? -1) - (a.cubePop ?? -1) ||
  (b.cubeElo ?? -1) - (a.cubeElo ?? -1) ||
  (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
  a.oracleId.localeCompare(b.oracleId);

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

/**
 * What the seed RESERVES before admitting filler: the four tagger roles plus
 * creatures — the one type share real cubes hold (≈46% of all cards, ≈54% of
 * nonland) that EDHREC rank order does not deliver. Commander's most-played
 * cards skew to noncreature staples, so a pure rank fill lands a 180-card cube
 * at 25% creatures (E285) — and treats role targets as mere permission, so
 * top-ranked filler takes every slot before a color's lower-ranked removal is
 * even reached (green picked 1 of a 7-card removal target from a pool of 86,
 * E286). A quota is a floor a card counts toward; a card can satisfy several.
 */
type Quota = Role | 'creature';
const QUOTAS: Quota[] = ['removal', 'boardwipe', 'ramp', 'cardDraw', 'creature'];
const isCreature = (c: CubeCard) => /\bcreature\b/i.test(c.typeLine);
function quotasOf(c: CubeCard): Quota[] {
  const q: Quota[] = [];
  if (c.role) q.push(c.role);
  if (isCreature(c)) q.push('creature');
  return q;
}
const fills = (c: CubeCard, k: Quota) => (k === 'creature' ? isCreature(c) : c.role === k);

/**
 * Cube-level quota (a count of NONLAND picks) per key. Roles are mined as
 * fractions of nonland cards; the creature share is mined over ALL cards, land
 * included, so it is re-based onto the nonland part here.
 */
function cubeQuotas(band: BandTargets, nonlandTarget: number): Record<Quota, number> {
  const creatureOfNonland = band.type.creature.median / Math.max(0.01, 1 - band.type.land.median);
  return {
    removal: Math.round(band.role.removal.median * nonlandTarget),
    boardwipe: Math.round(band.role.boardwipe.median * nonlandTarget),
    ramp: Math.round(band.role.ramp.median * nonlandTarget),
    cardDraw: Math.round(band.role.cardDraw.median * nonlandTarget),
    creature: Math.round(creatureOfNonland * nonlandTarget),
  };
}

/**
 * A role's quota is ALSO its ceiling. A floor alone let quality order over-fill
 * a role — EDHREC rank filled 15–18% of a cube with ramp against a corpus 8%
 * (E288), and the cube-native signal does the same with removal (cube staples
 * skew to interaction: with a p75 ceiling the seed sat at 29–31% removal and
 * the interaction term, centred on the median with a half-IQR tolerance, fell
 * to 0.6). So the seed lands each role on the corpus MEDIAN whenever the pool
 * can supply it, and the quality order decides only which non-role cards fill
 * the rest. Past its quota a role card is filler of last resort: deferred while
 * anything else can fill the slot, admitted only by the backfills so a cube
 * still fills. Creatures have no ceiling — the type term pulls them to the
 * median from both sides.
 */
const ROLES: Role[] = ['removal', 'boardwipe', 'ramp', 'cardDraw'];

/**
 * Split one cube-level quota across the nonland buckets. Each bucket's NATURAL
 * count (its own pool share of the key × its target size) is scaled by one
 * common factor so the buckets sum to `total` — a section keeps the shape of
 * the collection behind it, just denser or thinner as the corpus asks: a
 * colorless section that is a third creatures in the pool is asked for a
 * third-ish, not the cube-wide half; a green section short on removal carries
 * less of it, while W/B/R carry more. A bucket that would exceed its supply (or
 * its size) is pinned there and the remainder re-scaled over the rest, so the
 * cube-level total is still reached whenever the pool can reach it.
 */
function distributeQuota(
  total: number,
  buckets: Record<ColorBucket, CubeCard[]>,
  targetByBucket: Record<ColorBucket, number>,
  key: Quota
): Record<ColorBucket, number> {
  const out = {} as Record<ColorBucket, number>;
  const natural = {} as Record<ColorBucket, number>;
  const cap = {} as Record<ColorBucket, number>;
  let open: ColorBucket[] = [];
  for (const b of BUCKETS) {
    out[b] = 0;
    const supply = b === 'land' ? 0 : buckets[b].filter((c) => fills(c, key)).length;
    natural[b] = buckets[b].length > 0 ? (supply / buckets[b].length) * targetByBucket[b] : 0;
    cap[b] = Math.min(supply, targetByBucket[b]);
    if (cap[b] > 0 && natural[b] > 0) open.push(b);
  }
  let remaining = total;
  // Water-fill: pin any bucket the common factor would push past its cap, then
  // re-scale the rest. Terminates in ≤ BUCKETS.length rounds.
  for (let round = 0; round < BUCKETS.length && open.length > 0 && remaining > 0; round++) {
    const naturalSum = open.reduce((s, b) => s + natural[b], 0);
    const f = remaining / naturalSum;
    const pinned = open.filter((b) => natural[b] * f >= cap[b]);
    if (pinned.length === 0) {
      for (const b of open) out[b] = Math.round(natural[b] * f);
      break;
    }
    for (const b of pinned) {
      out[b] = cap[b];
      remaining -= cap[b];
    }
    open = open.filter((b) => !pinned.includes(b));
  }
  return out;
}

/** Select up to `target` cards from a bucket pool: quota cards (roles, creatures)
 *  are reserved as they come in rank order; filler is admitted only while enough
 *  slots remain for the quotas still unmet, shaped toward the curve targets. */
function selectBucket(
  pool: CubeCard[],
  target: number,
  band: BandTargets,
  isLandBucket: boolean,
  quota: Record<Quota, number>
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
  const fill = {} as Record<Quota, number>;
  for (const k of QUOTAS) fill[k] = 0;
  // Slots still owed to unmet quotas. A card that fills two quotas is counted
  // twice here, so this over-reserves slightly — filler waits a little longer,
  // and the quality backfill below still fills every slot.
  const deficit = () => QUOTAS.reduce((s, k) => s + Math.max(0, quota[k] - fill[k]), 0);

  const picks: CubeCard[] = [];
  const deferred: CubeCard[] = [];
  const take = (card: CubeCard) => {
    picks.push(card);
    curveFill[curveSlotOf(card.cmc)]++;
    for (const k of quotasOf(card)) fill[k]++;
  };

  // Fill slots by quality: a card owed by an unmet quota is always taken;
  // anything else only while the slots left exceed what the quotas still need
  // and only into an open curve slot. A role card past its quota is neither —
  // not even for the creature quota (a removal creature is still removal).
  const overCap = (c: CubeCard) => c.role != null && fill[c.role] >= quota[c.role];
  for (const card of sorted) {
    if (picks.length >= target) {
      deferred.push(card);
      continue;
    }
    const wanted = !overCap(card) && quotasOf(card).some((k) => fill[k] < quota[k]);
    const fillsCurve = curveFill[curveSlotOf(card.cmc)] < curveCap[curveSlotOf(card.cmc)];
    if (wanted || (fillsCurve && !overCap(card) && target - picks.length > deficit())) {
      take(card);
    } else {
      deferred.push(card);
    }
  }
  // If curve caps left us short, backfill from deferred (still quality-ordered):
  // anything under its role ceiling first, capped role cards only as a last
  // resort — otherwise the highest-signal deferred cards, which are exactly the
  // capped ones, would walk straight back in.
  for (const allowCapped of [false, true]) {
    for (let i = 0; i < deferred.length && picks.length < target; ) {
      const c = deferred[i];
      if (overCap(c) && !allowCapped) {
        i++;
        continue;
      }
      take(c);
      deferred.splice(i, 1);
    }
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

  // Cube-level role + creature quotas, split across the color buckets by where
  // the pool's supply lives (see distributeQuota).
  const totals = cubeQuotas(band, size - targetByBucket.land);
  const quotaByKey = {} as Record<Quota, Record<ColorBucket, number>>;
  for (const k of QUOTAS) quotaByKey[k] = distributeQuota(totals[k], buckets, targetByBucket, k);

  // Select per bucket, capping at what's owned.
  const picks: Pick[] = [];
  const byBucket = {} as Record<ColorBucket, number>;
  const leftovers: CubeCard[] = [];
  for (const b of BUCKETS) {
    const want = Math.min(targetByBucket[b], buckets[b].length);
    const quota = {} as Record<Quota, number>;
    for (const k of QUOTAS) quota[k] = quotaByKey[k][b];
    const { picks: sel, deferred } = selectBucket(buckets[b], want, band, b === 'land', quota);
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
    // Cube-level ceilings hold here too: the best leftovers are exactly the
    // role cards the buckets just capped, so take anything under its ceiling
    // first and capped role cards only as a last resort.
    const roleCount = {} as Record<Role, number>;
    for (const k of ROLES) roleCount[k] = 0;
    for (const p of picks) if (p.card.role) roleCount[p.card.role]++;
    const ordered = leftovers.sort(byQuality);
    const extra: CubeCard[] = [];
    const chosen = new Set<CubeCard>();
    for (const allowCapped of [false, true]) {
      for (const c of ordered) {
        if (extra.length >= need) break;
        if (chosen.has(c)) continue;
        if (!allowCapped && c.role != null && roleCount[c.role] >= totals[c.role]) continue;
        chosen.add(c);
        extra.push(c);
        if (c.role) roleCount[c.role]++;
      }
    }
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
      synergyLevel,
      totals
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
      text: `You own ${poolSize} non-basic singles, ${shortfall} short of a ${size}-card cube. Import more or pick a smaller size.`,
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
        )}–${Math.round(band.color[c].p75 * 100)}% real ${size}-card cubes run). You own fewer good ${COLOR_NAME[
          c
        ].toLowerCase()} cards than the template wants.`,
      });
    }
  }

  // Fixing: nonbasic land count vs corpus.
  if (got.land < band.fixingLands.p25) {
    gaps.push({
      severity: 'short',
      text: `Only ${got.land} fixing lands. Good ${size}-card cubes run ${Math.round(
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
        text: `Strong ${AXIS_LABEL.get(axis) ?? axis} support: ${n.producers} enablers / ${n.payoffs} payoffs in your collection. Slide toward Synergy to lean in.`,
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
          text: `${label}: ${n.producers} enablers but no payoff in your collection. Add payoff cards to make it draftable.`,
        });
        reported++;
      } else if (n.producers < enablerFloor || n.payoffs < payoffFloor) {
        gaps.push({
          severity: 'short',
          text: `${label}: ${n.producers} enablers / ${n.payoffs} payoffs, thin for a draftable archetype (good ${size}-card cubes want ~${enablerFloor} / ~${payoffFloor}). More in your collection would deepen it.`,
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
      text: 'Colors are evenly balanced, the hallmark of a well-built cube.',
    });
  }

  return gaps;
}
