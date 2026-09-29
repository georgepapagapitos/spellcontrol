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
import { canBeCommanderByType } from '@spellcontrol/binder-routing';

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

/** The two fields the classifier actually reads — narrower than `CubeCard` so
 *  the build page can call it straight on a collection-cache `EnrichedCard`
 *  row (typeLine optional there) for a live, no-network eligible-legend
 *  count, not just on a fully built pool card. */
interface LegendClassifiable {
  typeLine?: string;
  oracleText?: string;
}

// ── Partner / Background (board E462) ───────────────────────────────────────
// Real cubes carry these often (measured: 7 of 8 sampled real Commander cubes
// have Partner legends, 5 of 8 have Backgrounds) — Partner legends already
// pass `isLegendCandidate` unmarked (they're ordinary legendary creatures);
// Backgrounds are the real gap, since a Background is a "Legendary
// Enchantment — Background", never a creature and never "can be your
// commander" text, so `isLegendCandidate` alone never finds them.

/** "Partner with <Name> (reminder text)" — captures the exact required
 *  partner's name, since (unlike plain Partner) it can ONLY pair with that
 *  one named card. */
const PARTNER_WITH_RE = /Partner with ([^(\n]+?)\s*\(/i;
/** Plain "Partner (reminder text)" as its own line/clause — deliberately NOT
 *  matched by the "Partner with" case above (checked first). */
const PARTNER_PLAIN_RE = /(?:^|\n)\s*Partner\s*\(/im;
const FRIENDS_FOREVER_RE = /Friends forever/i;
/** Included for the tile/row LABEL only (see `legendKindLabel`) — matching
 *  the brief's "if simple": correctly enforcing that one half must be a
 *  Doctor-typed creature is real rules work `simulateCommanderDraft` doesn't
 *  do, so this kind is never treated as combinable there (see draft-sim.ts). */
const DOCTORS_COMPANION_RE = /Doctor's companion/i;

export type PartnerKind = 'partner' | 'partner-with' | 'friends-forever' | 'doctors-companion';

/** Which Partner-family keyword this legend has, if any. Checked in order of
 *  specificity: "Partner with" before plain "Partner" (its reminder text
 *  also contains the word "Partner", so the specific form must win first). */
export function partnerKindOf(c: LegendClassifiable): PartnerKind | null {
  const text = c.oracleText ?? '';
  if (PARTNER_WITH_RE.test(text)) return 'partner-with';
  if (PARTNER_PLAIN_RE.test(text)) return 'partner';
  if (FRIENDS_FOREVER_RE.test(text)) return 'friends-forever';
  if (DOCTORS_COMPANION_RE.test(text)) return 'doctors-companion';
  return null;
}

/** The exact card name a "Partner with" legend requires, or null for every
 *  other case (including plain Partner, which pairs with ANY Partner card). */
export function partnerNameOf(c: LegendClassifiable): string | null {
  const m = (c.oracleText ?? '').match(PARTNER_WITH_RE);
  return m ? m[1].trim() : null;
}

export function isPartnerLegend(c: LegendClassifiable): boolean {
  return partnerKindOf(c) !== null;
}

/** A legendary creature (or commander-legal planeswalker) that can choose a
 *  Background as its second commander — the OTHER half of the pairing is
 *  `isBackground`, a different card entirely. */
export function isChooseABackgroundLegend(c: LegendClassifiable): boolean {
  return /choose a background/i.test(c.oracleText ?? '');
}

/** A Background itself: a "Legendary Enchantment — Background", never a
 *  creature, so it never satisfies `isLegendCandidate` on its own — it only
 *  ever enters the legend section via `selectBackgrounds`, paired to a
 *  chooser already selected there. */
export function isBackground(c: LegendClassifiable): boolean {
  const t = c.typeLine ?? '';
  return /\blegendary\b/i.test(t) && /\benchantment\b/i.test(t) && /\bbackground\b/i.test(t);
}

/** The small text label a legend/background tile or row carries (never colour
 *  alone) — "Partner" for any Partner-family keyword (including Doctor's
 *  companion, label-only per the module doc above), "Background" for either
 *  half of the choose-a-Background pairing. null for an ordinary legend. */
export function legendKindLabel(c: LegendClassifiable): 'Partner' | 'Background' | null {
  if (isPartnerLegend(c)) return 'Partner';
  if (isChooseABackgroundLegend(c) || isBackground(c)) return 'Background';
  return null;
}

/** Commander-eligible by type: the app's one CR 903.3 rule
 *  (`canBeCommanderByType`: a legendary creature, Vehicle or Spacecraft with
 *  a power/toughness box, or "can be your commander"). Pure and
 *  oracle-data-only, same shape as `formatExclusion` — testable without a
 *  live pool. `format === 'commander'` never excludes anything (see
 *  ./play-format), so no exclusion check is needed here. */
export function isLegendCandidate(c: LegendClassifiable): boolean {
  return canBeCommanderByType(c.typeLine ?? '', c.oracleText ?? '');
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

/** Every legend identity bucket, in a fixed order — exported so ./draft-sim's
 *  commander pod simulation (board E461) can report per-identity draft rate
 *  and "nobody could build it" against the same 16 buckets this module quotas
 *  over, instead of re-deriving its own list. */
export const LEGEND_BUCKETS: LegendIdentity[] = [...COLORS, ...COLOR_PAIRS, 'other'];

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

/** "W" / "WU" / "3+ color" — plain enough for a reason string; PR3 owns the
 *  user-facing copy for the coverage readout. */
const labelFor = (b: LegendIdentity): string => (b === 'other' ? '3+ color' : b);

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

  const backgroundPicks = selectBackgrounds(picks, pool, alreadyPickedIds);
  if (backgroundPicks.length === 0) return picks;

  // Backgrounds join the section WITHIN the target, not on top of it (board
  // E462): make room by dropping the lowest-quality ordinary legends. Never a
  // chooser (it's the reason a Background got added), never a Partner-family
  // legend (dropping one would silently orphan its other half — legends have
  // no "locked" concept of their own to protect otherwise, see the module
  // doc), and never the LAST pick left in its identity bucket (the coverage
  // guarantee `distributeLegendQuota`'s own floors exist for — a Background
  // slot shouldn't zero out an identity the pool genuinely supports).
  const identityCounts = new Map<LegendIdentity, number>();
  for (const p of picks) identityCounts.set(p.identity, (identityCounts.get(p.identity) ?? 0) + 1);
  const protectedIds = new Set<string>();
  for (const p of picks) {
    if (
      isChooseABackgroundLegend(p.card) ||
      isPartnerLegend(p.card) ||
      identityCounts.get(p.identity) === 1
    ) {
      protectedIds.add(p.card.oracleId);
    }
  }
  const droppable = picks
    .filter((p) => !protectedIds.has(p.card.oracleId))
    .sort((a, b) => byQuality(a.card, b.card)); // best first, same order supply[b] was built in
  const dropIds = new Set(droppable.slice(-backgroundPicks.length).map((p) => p.card.oracleId));
  const kept = picks.filter((p) => !dropIds.has(p.card.oracleId));
  return [...kept, ...backgroundPicks];
}

/** Roughly one Background per choose-a-Background legend already selected —
 *  a real ceiling only for a degenerate pool (real cubes carry far fewer
 *  choosers than this; see the module's Finding note), never a normal limit. */
const MAX_BACKGROUNDS = 10;

/**
 * Backgrounds for the legend section's own choose-a-Background legends
 * (board E462) — a Background is never independently draftable (it isn't a
 * creature, so `isLegendCandidate` never finds it on its own), so it only
 * ever enters here, one per chooser, best quality first, preferring a
 * colour-identity overlap with its chooser and falling back to the next-best
 * Background when no match is left. `selectLegends` makes room for these
 * WITHIN the target by dropping an equal number of its weakest ordinary
 * picks (see there) — Backgrounds are part of the legend count, never a
 * second array added on top of it. No supply → returns `[]`, same "nothing
 * to add" shape every other legend helper uses when a pool has nothing to
 * offer.
 */
export function selectBackgrounds(
  legendPicks: readonly LegendPick[],
  pool: CubeCard[],
  alreadyPickedIds: ReadonlySet<string>
): LegendPick[] {
  const choosers = legendPicks
    .filter((p) => isChooseABackgroundLegend(p.card))
    .map((p) => p.card)
    .sort(byQuality);
  if (choosers.length === 0) return [];

  const usedIds = new Set<string>(alreadyPickedIds);
  for (const p of legendPicks) usedIds.add(p.card.oracleId);

  const backgrounds = pool
    .filter((c) => isBackground(c) && !usedIds.has(c.oracleId))
    .sort(byQuality);
  if (backgrounds.length === 0) return [];

  const cap = Math.min(choosers.length, backgrounds.length, MAX_BACKGROUNDS);
  const remaining = [...backgrounds];
  const picks: LegendPick[] = [];
  for (let i = 0; i < cap; i++) {
    const chooser = choosers[i];
    const chooserColors = identityColors(chooser);
    let idx = remaining.findIndex((bg) =>
      identityColors(bg).some((c) => chooserColors.includes(c))
    );
    if (idx === -1) idx = 0; // no colour match left — take the next-best Background anyway
    const [background] = remaining.splice(idx, 1);
    picks.push({
      card: background,
      identity: legendIdentityOf(background),
      reason: `Background for ${chooser.name}`,
    });
  }
  return picks;
}
