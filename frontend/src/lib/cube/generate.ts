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
import type { CubeFormat } from './play-format';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import type { CubeScore } from './objective';
import { AXIS_LABEL } from './objective';
import { refineCube } from './refine';
import {
  COLORS,
  COLOR_PAIRS,
  isLand,
  bucketOf,
  curveSlotOf,
  pairsFixedBy,
  type ColorPair,
  type CubeCard,
} from './core';

// The card shape and the pure classifiers live in ./core so `objective` and
// `refine` can reach them without importing back up into this module — that
// was a value-level import cycle. Re-exported here so every existing
// `from './cube/generate'` import site keeps working unchanged.
export { COLORS, COLOR_PAIRS, isLand, bucketOf, curveSlotOf, pairOf, pairsFixedBy } from './core';
export type { ColorPair, CubeCard } from './core';

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
  /** Play format the cube was shaped for (see ./play-format). Absent on cubes saved before formats = limited. */
  format?: CubeFormat;
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
  /**
   * Which corpus the cube is shaped toward — `limited` (draft cubes of this
   * size, the default) or `commander`. Eligibility is the POOL's business
   * (filterPool leaves the ineligible cards out before they get here).
   */
  format?: CubeFormat;
  /**
   * Per-pass progress from the refiner (only fires when `synergyLevel > 0`).
   * A side channel for the loading UI — never affects the generated cube.
   */
  onProgress?: (pass: number, maxIter: number) => void;
  /**
   * Cards that must appear in the result. Seated first in their color bucket —
   * they count toward that bucket's target, its curve caps, and the role/
   * creature quotas — and the refiner never swaps one out. Full `CubeCard`,
   * not just an oracleId: a locked card can have been sold or committed
   * elsewhere since it was locked, so it may no longer be in `rawPool`; its
   * saved data is what lets it still be seated.
   */
  locked?: CubeCard[];
  /**
   * oracleIds that must never appear in the result. Removed from the pool
   * before anything else runs. Wins over `locked` for the same card, so
   * banning a locked card always drops it.
   */
  banned?: string[];
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
const QUOTA_LABEL: Record<Quota, string> = {
  removal: 'Removal',
  boardwipe: 'Board wipe',
  ramp: 'Ramp',
  cardDraw: 'Card draw',
  creature: 'Creature',
};

const isBasic = (c: CubeCard) => /basic/i.test(c.typeLine) && isLand(c);

/** Singleton, no basics. Dedupe by oracleId keeping the best-ranked copy (byQuality). */
export function dedupeByOracle(rawPool: CubeCard[]): CubeCard[] {
  const byOracle = new Map<string, CubeCard>();
  for (const c of rawPool) {
    if (isBasic(c)) continue;
    const key = c.oracleId || c.name.toLowerCase();
    const prev = byOracle.get(key);
    if (!prev || byQuality(c, prev) < 0) byOracle.set(key, c);
  }
  return [...byOracle.values()];
}

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
export function apportion(
  shares: Record<ColorBucket, number>,
  size: number
): Record<ColorBucket, number> {
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

/** Which field of `byQuality` actually decided winner over loser, in the same
 *  priority order the comparator itself checks — or null when every field
 *  tied and the comparator fell back to oracleId (nothing meaningful to name). */
function decidingFactor(winner: CubeCard, loser: CubeCard): string | null {
  if ((winner.cubePop ?? -1) !== (loser.cubePop ?? -1)) return 'cube popularity';
  if ((winner.cubeElo ?? -1) !== (loser.cubeElo ?? -1)) return 'Elo';
  if ((winner.rank ?? Infinity) !== (loser.rank ?? Infinity)) return 'EDHREC rank';
  return null;
}

/** Append "beat X on Y" to a reason when a genuine runner-up existed — a card
 *  that competed for the same slot and never made the cube at all (not just
 *  lost this one mechanism to win it another way). Silent when there wasn't
 *  one (the last eligible card has nothing to have beaten). */
function withRunnerUp(base: string, winner: CubeCard, runnerUp: CubeCard | null): string {
  if (!runnerUp) return base;
  const factor = decidingFactor(winner, runnerUp);
  return factor ? `${base} · beat ${runnerUp.name} on ${factor}` : base;
}

/**
 * For every card in `ranked` (already in quality order), the nearest LATER
 * card in that same order whose oracleId is in `deferredIds` — the best
 * candidate that shared this exact ranking and genuinely never entered the
 * cube. One backward O(n) pass regardless of how many entries need an answer,
 * so a bucket's worth of runner-up lookups stays linear instead of the O(n^2)
 * a per-pick rescan would cost.
 */
function nextDeferredMap(
  ranked: CubeCard[],
  deferredIds: ReadonlySet<string>
): Map<string, CubeCard | null> {
  const out = new Map<string, CubeCard | null>();
  let next: CubeCard | null = null;
  for (let i = ranked.length - 1; i >= 0; i--) {
    const c = ranked[i];
    if (deferredIds.has(c.oracleId)) {
      next = c;
    } else {
      out.set(c.oracleId, next);
    }
  }
  return out;
}

/** Select up to `target` cards from a bucket pool: quota cards (roles, creatures)
 *  are reserved as they come in rank order; filler is admitted only while enough
 *  slots remain for the quotas still unmet, shaped toward the curve targets.
 *  `seed` (locked cards already assigned to this bucket) is taken unconditionally
 *  first and counts toward `target`, the curve caps, and the quotas — `target`
 *  itself is never allowed to fall below the seed count, so a locked card is
 *  never dropped even if it overflows the bucket's normal share.
 *
 *  Also returns `reasons`: the true reason each non-seed pick entered (a quota,
 *  a curve slot, or backfill after curve caps), plus the best card that
 *  competed for the same slot and lost, if there was one. The caller assigns
 *  seed cards their own "Locked" reason instead of reading this map for them. */
type BucketPickMeta =
  | { kind: 'quota'; key: Quota; n: number }
  | { kind: 'curve'; slot: CurveSlot }
  | { kind: 'backfill' };

function selectBucket(
  pool: CubeCard[],
  target: number,
  band: BandTargets,
  quota: Record<Quota, number>,
  bucket: ColorBucket,
  seed: CubeCard[] = []
): { picks: CubeCard[]; deferred: CubeCard[]; reasons: Map<string, string> } {
  const colorLabel = COLOR_NAME[bucket];
  const reasons = new Map<string, string>();
  const effectiveTarget = Math.max(target, seed.length);
  const sorted = [...pool].sort(byQuality);
  if (sorted.length + seed.length <= effectiveTarget) {
    const need = Math.max(0, effectiveTarget - seed.length);
    const picked = sorted.slice(0, need);
    // Nothing was excluded (the whole pool fits), so there's no competitor to
    // have beaten — every pick here is simply the next-best owned card.
    for (const c of picked) reasons.set(c.oracleId, `${colorLabel} · filler by quality`);
    return { picks: [...seed, ...picked], deferred: sorted.slice(need), reasons };
  }

  const curveCap: Record<CurveSlot, number> = {} as Record<CurveSlot, number>;
  const curveFill: Record<CurveSlot, number> = {} as Record<CurveSlot, number>;
  for (let s = 0; s <= 7; s++) {
    curveCap[String(s) as CurveSlot] = Math.ceil(
      band.curve[String(s) as CurveSlot].median * effectiveTarget
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
  const meta = new Map<string, BucketPickMeta>();
  const bumpFill = (card: CubeCard) => {
    curveFill[curveSlotOf(card.cmc)]++;
    for (const k of quotasOf(card)) fill[k]++;
  };
  const admit = (card: CubeCard, m?: (fillAfter: Record<Quota, number>) => BucketPickMeta) => {
    picks.push(card);
    bumpFill(card);
    if (m) meta.set(card.oracleId, m(fill));
  };
  for (const c of seed) admit(c); // reasoned "Locked" by the caller, not here

  // Fill slots by quality: a card owed by an unmet quota is always taken;
  // anything else only while the slots left exceed what the quotas still need
  // and only into an open curve slot. A role card past its quota is neither —
  // not even for the creature quota (a removal creature is still removal).
  const overCap = (c: CubeCard) => c.role != null && fill[c.role] >= quota[c.role];
  for (const card of sorted) {
    if (picks.length >= effectiveTarget) {
      deferred.push(card);
      continue;
    }
    const quotaKey = !overCap(card) ? quotasOf(card).find((k) => fill[k] < quota[k]) : undefined;
    const slot = curveSlotOf(card.cmc);
    const fillsCurve = curveFill[slot] < curveCap[slot];
    if (quotaKey !== undefined) {
      admit(card, (f) => ({ kind: 'quota', key: quotaKey, n: f[quotaKey] }));
    } else if (fillsCurve && !overCap(card) && effectiveTarget - picks.length > deficit()) {
      admit(card, () => ({ kind: 'curve', slot }));
    } else {
      deferred.push(card);
    }
  }
  // If curve caps left us short, backfill from deferred (still quality-ordered):
  // anything under its role ceiling first, capped role cards only as a last
  // resort — otherwise the highest-signal deferred cards, which are exactly the
  // capped ones, would walk straight back in.
  const preBackfillDeferred = deferred.slice();
  for (const allowCapped of [false, true]) {
    for (let i = 0; i < deferred.length && picks.length < effectiveTarget;) {
      const c = deferred[i];
      if (overCap(c) && !allowCapped) {
        i++;
        continue;
      }
      admit(c, () => ({ kind: 'backfill' }));
      deferred.splice(i, 1);
    }
  }

  // Reason text, built once picks/deferred are final — the runner-up needs to
  // know who genuinely never made the cube, not just who lost THIS mechanism.
  const deferredIds = new Set(deferred.map((c) => c.oracleId));
  const byQuotaKey = new Map<Quota, CubeCard[]>();
  for (const k of QUOTAS)
    byQuotaKey.set(
      k,
      sorted.filter((c) => fills(c, k))
    );
  const runnerUpByQuota = new Map<Quota, Map<string, CubeCard | null>>();
  for (const k of QUOTAS) runnerUpByQuota.set(k, nextDeferredMap(byQuotaKey.get(k)!, deferredIds));
  const byCurveSlot = new Map<CurveSlot, CubeCard[]>();
  for (let s = 0; s <= 7; s++) {
    const slot = String(s) as CurveSlot;
    byCurveSlot.set(
      slot,
      sorted.filter((c) => curveSlotOf(c.cmc) === slot)
    );
  }
  const runnerUpByCurve = new Map<CurveSlot, Map<string, CubeCard | null>>();
  for (let s = 0; s <= 7; s++) {
    const slot = String(s) as CurveSlot;
    runnerUpByCurve.set(slot, nextDeferredMap(byCurveSlot.get(slot)!, deferredIds));
  }
  const runnerUpBackfill = nextDeferredMap(preBackfillDeferred, deferredIds);

  for (const c of picks) {
    const m = meta.get(c.oracleId);
    if (!m) continue; // a seed (locked) card — the caller supplies its reason
    if (m.kind === 'quota') {
      const runnerUp = runnerUpByQuota.get(m.key)!.get(c.oracleId) ?? null;
      const base = `${QUOTA_LABEL[m.key]} quota (${m.n} of ${Math.round(quota[m.key])})`;
      reasons.set(c.oracleId, withRunnerUp(base, c, runnerUp));
    } else if (m.kind === 'curve') {
      const runnerUp = runnerUpByCurve.get(m.slot)!.get(c.oracleId) ?? null;
      const slotLabel = m.slot === '7' ? '7+' : m.slot;
      const base = `${colorLabel} · ${slotLabel}-drop`;
      reasons.set(c.oracleId, withRunnerUp(base, c, runnerUp));
    } else {
      const runnerUp = runnerUpBackfill.get(c.oracleId) ?? null;
      const base = `${colorLabel} · backfill after curve caps`;
      reasons.set(c.oracleId, withRunnerUp(base, c, runnerUp));
    }
  }
  return { picks, deferred, reasons };
}

/**
 * Fixing lands, spread across the ten color pairs by the corpus's own per-pair
 * fixing counts (`band.pairs[p].fixingLands`) instead of by popularity alone
 * (item 2 of the pair-aware program) — popularity only ranks WITHIN a pair
 * (and among lands that fix no pair at all, e.g. a mono-color utility land).
 * A land that fixes several pairs (a triland, a five-color land) counts toward
 * each of them at once, exactly like it does at the table: this deliberately
 * ISN'T a partition, so one land can satisfy two pairs' deficits simultaneously.
 *
 * Pass 1 fills each pair's own deficit, biggest corpus target first (ties
 * broken by `COLOR_PAIRS` order for determinism), best-quality qualifying land
 * first. Pass 2 fills whatever's left by pure quality (utility/mono lands, or
 * any pair whose deficit the pool couldn't reach). No curve/quota shaping here
 * — lands never carry a role/creature quota, and the refiner never touches the
 * land bucket (see refine.ts), so this greedy fill is the land bucket's only
 * shot at the corpus shape.
 */
function selectFixingLands(
  pool: CubeCard[],
  target: number,
  band: BandTargets,
  seed: CubeCard[] = []
): { picks: CubeCard[]; deferred: CubeCard[]; reasons: Map<string, string> } {
  const reasons = new Map<string, string>();
  const effectiveTarget = Math.max(target, seed.length);
  const sorted = [...pool].sort(byQuality);
  if (sorted.length + seed.length <= effectiveTarget) {
    // Nothing was excluded, so there's no runner-up to name.
    for (const c of sorted) reasons.set(c.oracleId, 'Fixing / utility land');
    return { picks: [...seed, ...sorted], deferred: [], reasons };
  }

  const picked: CubeCard[] = [...seed];
  const pickedIds = new Set(picked.map((c) => c.oracleId));
  const pairCount = {} as Record<ColorPair, number>;
  for (const p of COLOR_PAIRS) pairCount[p] = 0;
  for (const c of seed) for (const p of pairsFixedBy(c)) pairCount[p]++;

  const pairTarget = {} as Record<ColorPair, number>;
  for (const p of COLOR_PAIRS) pairTarget[p] = band.pairs[p].fixingLands.median;
  const order = [...COLOR_PAIRS].sort(
    (a, b) => pairTarget[b] - pairTarget[a] || COLOR_PAIRS.indexOf(a) - COLOR_PAIRS.indexOf(b)
  );
  // Which pair (if any) each non-seed land was admitted FOR in pass 1, and
  // that pair's fill count right after — the land bucket's version of the
  // quota "(n of target)" bookkeeping.
  const admittedFor = new Map<string, { pair: ColorPair; n: number }>();
  for (const p of order) {
    for (const c of sorted) {
      if (picked.length >= effectiveTarget || pairCount[p] >= pairTarget[p]) break;
      if (pickedIds.has(c.oracleId) || !pairsFixedBy(c).includes(p)) continue;
      picked.push(c);
      pickedIds.add(c.oracleId);
      for (const pp of pairsFixedBy(c)) pairCount[pp]++;
      admittedFor.set(c.oracleId, { pair: p, n: pairCount[p] });
    }
  }
  for (const c of sorted) {
    if (picked.length >= effectiveTarget) break;
    if (pickedIds.has(c.oracleId)) continue;
    picked.push(c);
    pickedIds.add(c.oracleId);
  }
  const deferred = sorted.filter((c) => !pickedIds.has(c.oracleId));
  const deferredIds = new Set(deferred.map((c) => c.oracleId));

  const byPair = new Map<ColorPair, CubeCard[]>();
  for (const p of COLOR_PAIRS)
    byPair.set(
      p,
      sorted.filter((c) => pairsFixedBy(c).includes(p))
    );
  const runnerUpByPair = new Map<ColorPair, Map<string, CubeCard | null>>();
  for (const p of COLOR_PAIRS) runnerUpByPair.set(p, nextDeferredMap(byPair.get(p)!, deferredIds));

  for (const c of picked) {
    const forPair = admittedFor.get(c.oracleId);
    if (!forPair) {
      if (!seed.some((s) => s.oracleId === c.oracleId))
        reasons.set(c.oracleId, 'Fixing / utility land');
      continue; // seed: reasoned "Locked" by the caller
    }
    const runnerUp = runnerUpByPair.get(forPair.pair)!.get(c.oracleId) ?? null;
    const base = `Fixes ${forPair.pair} (${forPair.n} of ${Math.round(pairTarget[forPair.pair])})`;
    reasons.set(c.oracleId, withRunnerUp(base, c, runnerUp));
  }
  return { picks: picked, deferred, reasons };
}

function reasonFor(c: CubeCard, bucket: ColorBucket): string {
  if (bucket === 'land') return 'Fixing / utility land';
  const base = COLOR_NAME[bucket];
  if (c.role) return `${base} · ${ROLE_NAME[c.role]}`;
  const slot = curveSlotOf(c.cmc);
  return `${base} · ${slot === '7' ? '7+' : slot}-drop`;
}

/** The cube overall came up short of `size`, so a slot was filled from a
 *  DIFFERENT bucket's leftovers instead of this one's own supply — a distinct
 *  reason from every in-bucket kind above, since nothing here competed for
 *  this specific slot. */
function crossBackfillReasonFor(bucket: ColorBucket): string {
  if (bucket === 'land') return 'Fixing / utility land · added to reach the full cube';
  return `${COLOR_NAME[bucket]} · added because another color came up short`;
}

export function generateCube(
  rawPool: CubeCard[],
  size: CubeSize,
  options?: CubeGenOptions
): GeneratedCube {
  const format: CubeFormat = options?.format ?? 'limited';
  const band = targetsForSize(size, format);
  const synergyLevel = Math.max(0, Math.min(1, options?.synergyLevel ?? 0));

  // Banned cards leave the pool before anything else runs. Bans win over locks
  // for the same card (a banned card never comes back, even if also locked).
  const bannedSet = new Set(options?.banned ?? []);
  let pool = dedupeByOracle(rawPool.filter((c) => !bannedSet.has(c.oracleId)));
  const locked = (options?.locked ?? []).filter((c) => !bannedSet.has(c.oracleId));
  const lockedIds = new Set(locked.map((c) => c.oracleId));

  // A locked card may no longer be in rawPool (sold, or committed elsewhere) —
  // splice its saved data in so it still participates in scoring/quality-sort.
  const poolIds = new Set(pool.map((c) => c.oracleId));
  for (const c of locked) {
    if (!poolIds.has(c.oracleId)) {
      pool = [...pool, c];
      poolIds.add(c.oracleId);
    }
  }

  // Bucket the pool, minus locked cards — those are seeded directly into their
  // bucket below instead of competing as normal candidates.
  const buckets = {} as Record<ColorBucket, CubeCard[]>;
  for (const b of BUCKETS) buckets[b] = [];
  for (const c of pool) {
    if (!lockedIds.has(c.oracleId)) buckets[bucketOf(c)].push(c);
  }

  // Target count per bucket (empirical color shares; land uses the fixing-land target).
  const shares = {} as Record<ColorBucket, number>;
  for (const b of BUCKETS) shares[b] = band.color[b].median;
  const targetByBucket = apportion(shares, size);

  // Cube-level role + creature quotas, split across the color buckets by where
  // the pool's supply lives (see distributeQuota). Supply is read from `buckets`
  // (locked cards excluded) — a locked role card still counts toward its own
  // bucket's quota via the seed below, but not toward the cross-bucket SPLIT of
  // the cube-level total.
  // ponytail: minor undercount of a bucket's natural supply when it holds a
  // locked role/creature card; upgrade path is folding `locked` into
  // distributeQuota's supply calc if this is ever measured to matter.
  const totals = cubeQuotas(band, size - targetByBucket.land);
  const quotaByKey = {} as Record<Quota, Record<ColorBucket, number>>;
  for (const k of QUOTAS) quotaByKey[k] = distributeQuota(totals[k], buckets, targetByBucket, k);

  // Select per bucket, capping at what's owned. `want` never drops below the
  // bucket's locked count — a locked card is never dropped, even if it
  // overflows the bucket's normal share of `size`.
  const picks: Pick[] = [];
  const byBucket = {} as Record<ColorBucket, number>;
  const leftovers: CubeCard[] = [];
  for (const b of BUCKETS) {
    const lockedInBucket = locked.filter((c) => bucketOf(c) === b);
    const want = Math.min(
      Math.max(targetByBucket[b], lockedInBucket.length),
      buckets[b].length + lockedInBucket.length
    );
    const quota = {} as Record<Quota, number>;
    for (const k of QUOTAS) quota[k] = quotaByKey[k][b];
    // Land gets a pair-aware selector (selectFixingLands, below); every other
    // bucket including multicolor keeps the plain quota/curve fill. A gold-pair
    // floor for multicolor was tried and measured to cost archetype depth: it
    // takes a slot pure quality would have spent on the pool's best card
    // (usually the archetype's own leaning pair) and gives it to a fairness
    // target instead. Removed; the pair-band guards in generate.live.test.ts
    // are the tripwire if a pool ever leaves a well-supported pair starved.
    const {
      picks: sel,
      deferred,
      reasons,
    } = b === 'land'
      ? selectFixingLands(buckets[b], want, band, lockedInBucket)
      : selectBucket(buckets[b], want, band, quota, b, lockedInBucket);
    byBucket[b] = sel.length;
    for (const c of sel) {
      const reason = lockedIds.has(c.oracleId)
        ? 'Locked'
        : (reasons.get(c.oracleId) ?? reasonFor(c, b));
      picks.push({ card: c, bucket: b, reason });
    }
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
      picks.push({ card: c, bucket: b, reason: crossBackfillReasonFor(b) });
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
      totals,
      options?.onProgress,
      lockedIds
    );
    finalPicks = refined.picks;
    finalByBucket = refined.byBucket;
    score = refined.score;
  }
  return {
    size,
    format,
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
