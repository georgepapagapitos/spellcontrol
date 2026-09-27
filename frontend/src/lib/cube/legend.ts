// A Commander-format cube's legend section — the pool of legendary creatures
// (plus the handful of planeswalkers/backgrounds Wizards explicitly made
// commander-legal) a cube offers ADDITIONAL to its stated spell size (board
// enhancement #12, PR1; see the approved design doc's open questions 1-3).
//
// Deliberately NOT woven into ./generate's bucket/quota machinery: a legend is
// chosen for what it enables as a commander (a wide colour-identity spread),
// not for its curve slot, so it doesn't share a quota mechanism with the
// spells section. It is also kept OUT of `GeneratedCube.picks` entirely (its
// own `legends` array) — ./refine's swap machinery only ever reads/writes
// `picks`, so a legend can never be swapped in or out by the refiner by
// construction. No change to refine.ts, scorer-state.ts or objective.ts was
// needed for this; that omission is deliberate, not an oversight.
//
// No mined corpus exists yet for a legend section's own colour-identity mix
// (unlike the spell corpus in ./cube-targets.json) — the design doc flags this
// as follow-up mining. Until then the weights below are REASONED, not mined:
// two-colour identities are the most common shape for a card actually printed
// to be a commander, mono second, 3+/5-colour rarer still.

import {
  COLORS,
  COLOR_PAIRS,
  byQuality,
  identityColors,
  pairOf,
  type ColorPair,
  type CubeCard,
} from './core';
import type { CubeSize } from './targets';

/** A legend's colour identity, at the granularity the section is organized by:
 *  a single colour, one of the ten two-colour pairs, or 'other' for anything
 *  else (colourless, or 3+ colours — real but rare, and not worth its own
 *  per-combination quota at v1). */
export type LegendIdentity = (typeof COLORS)[number] | ColorPair | 'other';

export interface LegendPick {
  card: CubeCard;
  identity: LegendIdentity;
  reason: string;
}

const CAN_BE_COMMANDER_RE = /can be your commander/i;

/** The two fields the classifier actually reads — narrower than `CubeCard` so
 *  the build page can call it straight on a collection-cache `EnrichedCard`
 *  row (typeLine optional there) for a live, no-network eligible-legend
 *  count, not just on a fully built pool card. */
interface LegendClassifiable {
  typeLine?: string;
  oracleText?: string;
}

/** Commander-eligible: a legendary creature, or oracle text carrying the
 *  "can be your commander" pattern (backgrounds, and the few planeswalkers/
 *  battles Wizards made commander-legal — Daretti, Freyalise, Minsc & Boo).
 *  Pure and oracle-data-only, same shape as `formatExclusion` — testable
 *  without a live pool. `format === 'commander'` never excludes anything
 *  (see ./play-format), so no exclusion check is needed here. */
export function isLegendCandidate(c: LegendClassifiable): boolean {
  const typeLine = c.typeLine ?? '';
  if (/\blegendary\b/i.test(typeLine) && /\bcreature\b/i.test(typeLine)) return true;
  return CAN_BE_COMMANDER_RE.test(c.oracleText ?? '');
}

/** This legend's identity bucket — mono/pair/other, same basis `pairOf` uses
 *  (colorIdentity, falling back to colors). */
export function legendIdentityOf(c: CubeCard): LegendIdentity {
  const colors = [...new Set(identityColors(c))];
  if (colors.length === 1) return colors[0] as (typeof COLORS)[number];
  if (colors.length === 2) {
    const pair = pairOf(c);
    if (pair) return pair;
  }
  return 'other';
}

const LEGEND_BUCKETS: LegendIdentity[] = [...COLORS, ...COLOR_PAIRS, 'other'];

/**
 * Legend section size, additional to the stated cube size — a near-fixed
 * ABSOLUTE count real Commander cubes hold regardless of total size (design
 * doc finding 2: 90-140 across a 590-960 spread of total cube size), not a
 * percentage. Approved sizing table (2026-09-27), pending a proper mining
 * pass over a legend-tagged corpus.
 */
export const LEGEND_TARGET: Record<CubeSize, number> = {
  180: 60,
  270: 80,
  360: 100,
  450: 110,
  540: 120,
  720: 130,
};

/** Reasoned relative weight per identity bucket once every bucket's own floor
 *  is met — see the module doc for why this isn't mined yet. */
const LEGEND_WEIGHT: Record<LegendIdentity, number> = (() => {
  const w = {} as Record<LegendIdentity, number>;
  for (const c of COLORS) w[c] = 1;
  for (const p of COLOR_PAIRS) w[p] = 1;
  w.other = 0.3;
  return w;
})();

/** Every mono colour gets this many slots before the weighted water-fill runs
 *  — a Commander cube's legend section always offers a real mono option per
 *  colour (design doc § Pool design), capped by what the pool actually owns. */
const MONO_FLOOR = 5;
/** Every OTHER identity bucket the pool can supply at all still gets at least
 *  one slot — the coverage guarantee: a colour identity the pool genuinely
 *  supports is never left at zero just because it's a thin pair. */
const OTHER_FLOOR = 1;

const isMono = (b: LegendIdentity): boolean => (COLORS as readonly string[]).includes(b);

/**
 * Split the legend target across identity buckets: each bucket's floor first
 * (capped by supply), then the remainder water-filled by `LEGEND_WEIGHT`,
 * pinning any bucket the common factor would push past its supply and
 * re-scaling the rest — the same pin-and-rescale shape as ./generate's
 * `distributeQuota`, just over identity buckets instead of colour buckets
 * (a genuinely different domain: a legend's identity isn't its `bucketOf`).
 */
export function distributeLegendQuota(
  total: number,
  supply: Record<LegendIdentity, CubeCard[]>
): Record<LegendIdentity, number> {
  const cap = {} as Record<LegendIdentity, number>;
  const out = {} as Record<LegendIdentity, number>;
  for (const b of LEGEND_BUCKETS) {
    cap[b] = supply[b].length;
    out[b] = Math.min(isMono(b) ? MONO_FLOOR : OTHER_FLOOR, cap[b]);
  }
  const used = LEGEND_BUCKETS.reduce((s, b) => s + out[b], 0);

  // A legend target smaller than every floor combined (not a size this app
  // offers today, but defensive): drop the floors and hand out one slot per
  // supplied bucket, fixed order, until the target itself is spent.
  if (used > total) {
    for (const b of LEGEND_BUCKETS) out[b] = 0;
    let remaining = total;
    for (const b of LEGEND_BUCKETS) {
      if (remaining <= 0 || cap[b] === 0) continue;
      out[b] = 1;
      remaining--;
    }
    return out;
  }

  let remaining = total - used;
  let open = LEGEND_BUCKETS.filter((b) => out[b] < cap[b]);
  for (let round = 0; round < LEGEND_BUCKETS.length && open.length > 0 && remaining > 0; round++) {
    const weightSum = open.reduce((s, b) => s + LEGEND_WEIGHT[b], 0) || open.length;
    const natural = new Map(
      open.map((b) => [b, (LEGEND_WEIGHT[b] / weightSum) * remaining] as const)
    );
    const pinned = open.filter((b) => out[b] + natural.get(b)! >= cap[b]);
    if (pinned.length === 0) {
      const floored = open.map((b) => {
        const v = natural.get(b)!;
        return { b, f: Math.floor(v), r: v - Math.floor(v) };
      });
      let usedRound = floored.reduce((s, e) => s + e.f, 0);
      for (const e of floored) out[e.b] += e.f;
      for (const e of [...floored].sort(
        (x, y) => y.r - x.r || LEGEND_BUCKETS.indexOf(x.b) - LEGEND_BUCKETS.indexOf(y.b)
      )) {
        if (usedRound >= remaining) break;
        out[e.b]++;
        usedRound++;
      }
      remaining -= usedRound;
      break;
    }
    for (const b of pinned) {
      remaining -= cap[b] - out[b];
      out[b] = cap[b];
    }
    open = open.filter((b) => !pinned.includes(b));
  }
  return out;
}

/** "W" / "WU" / "3+ colour" — plain enough for a reason string; PR3 owns the
 *  user-facing copy for the coverage readout. */
const labelFor = (b: LegendIdentity): string => (b === 'other' ? '3+ colour' : b);

/**
 * The legend section for a Commander cube: every `isLegendCandidate` card in
 * `pool` not already used as a spell (`alreadyPickedIds` — the final spell
 * picks' oracleIds, so a legendary creature the greedy or refiner actually
 * seated as a spell is never double-counted here), ranked by the same
 * cube-native signal as spells (`byQuality`) and spread across colour
 * identity via `distributeLegendQuota`. Additional to the cube's stated size —
 * the caller never subtracts this from `size`.
 */
export function selectLegends(
  pool: CubeCard[],
  size: CubeSize,
  alreadyPickedIds: ReadonlySet<string>
): LegendPick[] {
  const target = LEGEND_TARGET[size];
  const candidates = pool.filter((c) => isLegendCandidate(c) && !alreadyPickedIds.has(c.oracleId));

  const supply = {} as Record<LegendIdentity, CubeCard[]>;
  for (const b of LEGEND_BUCKETS) supply[b] = [];
  for (const c of candidates) supply[legendIdentityOf(c)].push(c);
  for (const b of LEGEND_BUCKETS) supply[b].sort(byQuality);

  const quota = distributeLegendQuota(target, supply);
  const picks: LegendPick[] = [];
  for (const b of LEGEND_BUCKETS) {
    const chosen = supply[b].slice(0, quota[b]);
    chosen.forEach((card, i) => {
      picks.push({ card, identity: b, reason: `${labelFor(b)} legend (${i + 1} of ${quota[b]})` });
    });
  }
  return picks;
}
