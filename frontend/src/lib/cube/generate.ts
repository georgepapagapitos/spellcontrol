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

export interface CubeCard {
  name: string;
  oracleId: string;
  colors: string[]; // [] = colorless
  cmc: number;
  typeLine: string;
  role: Role | null; // precomputed via the shared tagger
  rank?: number; // edhrecRank — lower is more-played; undefined = unknown
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
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
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

const isLand = (c: CubeCard) => /\bland\b/i.test(c.typeLine);
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

/** quality: lower edhrecRank = better; unknown rank sorts last. */
const byQuality = (a: CubeCard, b: CubeCard) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

/** Largest-remainder apportionment so bucket targets sum exactly to `size`. */
function apportion(shares: Record<ColorBucket, number>, size: number): Record<ColorBucket, number> {
  const exact = BUCKETS.map((b) => ({ b, v: shares[b] * size }));
  const floored = exact.map((e) => ({ ...e, f: Math.floor(e.v), r: e.v - Math.floor(e.v) }));
  let used = floored.reduce((s, e) => s + e.f, 0);
  const out = {} as Record<ColorBucket, number>;
  for (const e of floored) out[e.b] = e.f;
  for (const e of [...floored].sort((x, y) => y.r - x.r)) {
    if (used >= size) break;
    out[e.b]++;
    used++;
  }
  return out;
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
  for (const card of sorted) {
    if (picks.length >= target) {
      deferred.push(card);
      continue;
    }
    const slot = curveSlotOf(card.cmc);
    const fillsCurve = curveFill[slot] < curveCap[slot];
    const fillsRole = card.role != null && roleFill[card.role] < roleTarget[card.role];
    if (fillsCurve || fillsRole) {
      picks.push(card);
      curveFill[slot]++;
      if (card.role) roleFill[card.role]++;
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

export function generateCube(rawPool: CubeCard[], size: CubeSize): GeneratedCube {
  const band = targetsForSize(size);

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

  const gaps = buildGaps(byBucket, band, size, pool.length, shortfall);
  return { size, picks, byBucket, targetByBucket, gaps, shortfall, poolSize: pool.length };
}

function buildGaps(
  got: Record<ColorBucket, number>,
  band: BandTargets,
  size: number,
  poolSize: number,
  shortfall: number
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
