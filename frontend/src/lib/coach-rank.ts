/**
 * Coach ranker — pure, deterministic tier assignment for the CoachFeed.
 *
 * Lane → sub-score mapping:
 *   fill-gaps  → roles       (structural gaps in functional-role coverage)
 *   upgrade    → cardFit     (weak-fit slots that better cards can fill)
 *   collection → roles       (same gap coverage, owned cards)
 *   bracket-fit → cardFit    (bracket-alignment coaching)
 *   budget     → always tier 3 (polish, not quality)
 *   combos     → always tier 3 (polish, opportunistic)
 *   similar    → always tier 3
 *
 * Tier assignment:
 *   Tier 1: fill-gaps or upgrade when their target sub-score < 60 (severe deficit).
 *   Tier 2: changes targeting a sub-score that is both the weakest AND < 75.
 *   Tier 3: everything else (budget, combos, similar, bracket-fit when in-band,
 *            upgrade/collection when sub-score >= 75, cuts).
 */
import type { Change } from './deck-change';
import type { PlanScore, SubScoreKey } from '@/deck-builder/services/deckBuilder/planScore';

export interface CoachContext {
  planScore?: PlanScore;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  deckSize: number;
  deckTarget: number;
  bracketOverridePresent: boolean;
  ownedNames: Set<string>;
}

export interface RankedMove {
  change: Change;
  tier: 1 | 2 | 3;
  /** True when the change is a cut (used by UI to group cuts separately). */
  isCut?: boolean;
}

/** Sort rank for ownership: owned = 0, in-other-deck = 1, unowned/undefined = 2. */
function ownershipRank(c: Change): number {
  if (c.ownership === 'owned') return 0;
  if (c.ownership === 'in-other-deck') return 1;
  return 2;
}

/** The sub-score a lane targets for tier promotion. */
const LANE_SUBSCORE: Partial<Record<NonNullable<Change['lane']>, SubScoreKey>> = {
  'fill-gaps': 'roles',
  upgrade: 'cardFit',
  collection: 'roles',
  'bracket-fit': 'cardFit',
};

/** Tier-3-only lanes — budget saves money but is never a quality concern.
 *  Combos are NOT listed here anymore: an owned-piece combo completion is tier 2
 *  (tonight's "free win"); unowned combo pieces stay tier 3. */
const ALWAYS_TIER_3 = new Set<Change['lane']>(['budget', 'similar']);

/**
 * Rank a flat list of Changes into tier-ordered RankedMoves.
 *
 * Tier logic:
 *   1. Tier 1: fill-gaps/upgrade AND their target sub-score < 60 (severe gap).
 *   2. Tier 2: lane targets the weakest non-partial sub-score AND that score < 75.
 *   3. Tier 3: everything else.
 *
 * Within-tier order: owned < in-other-deck < unowned/undefined, then
 * deltaScore descending (undefined = 0), then inclusion descending, then
 * name ascending (deterministic tie-break).
 *
 * Cuts are always tier 3 and marked with isCut:true.
 */
export function rankCoachMoves(changes: Change[], ctx: CoachContext): RankedMove[] {
  const { planScore } = ctx;

  // Find the weakest non-partial sub-score.
  let weakestKey: SubScoreKey | null = null;
  let weakestValue = Infinity;
  if (planScore) {
    for (const key of Object.keys(planScore.subscores) as SubScoreKey[]) {
      const s = planScore.subscores[key];
      if (s.partial) continue;
      if (s.value < weakestValue) {
        weakestValue = s.value;
        weakestKey = key;
      }
    }
  }

  function assignTier(c: Change): 1 | 2 | 3 {
    // Cuts are always tier 3.
    if (c.type === 'cut') return 3;

    // Tier-3-only lanes.
    if (ALWAYS_TIER_3.has(c.lane)) return 3;

    // Combos lane: owned missing piece = tier 2 ("build it tonight"),
    // unowned missing piece = tier 3 ("nice to have, go buy it").
    if (c.lane === 'combos') {
      return c.ownership === 'owned' ? 2 : 3;
    }

    const targetKey = LANE_SUBSCORE[c.lane];
    if (!targetKey) return 3;

    const subScore = planScore?.subscores[targetKey];
    const score = subScore?.partial ? undefined : subScore?.value;

    // Tier 1: severe structural gap (< 60) for fill-gaps or upgrade.
    if ((c.lane === 'fill-gaps' || c.lane === 'upgrade') && score !== undefined && score < 60) {
      return 1;
    }

    // Tier 2: this lane's target sub-score is the weakest AND < 75.
    if (weakestKey !== null && targetKey === weakestKey && weakestValue < 75) {
      return 2;
    }

    return 3;
  }

  function withinTierKey(r: RankedMove): [number, number, number, string] {
    const oRank = ownershipRank(r.change);
    const dScore = r.change.deltaScore ?? 0;
    const incl = r.change.inclusion ?? -1;
    return [oRank, -dScore, -incl, r.change.name];
  }

  const ranked: RankedMove[] = changes.map((c) => ({
    change: c,
    tier: assignTier(c),
    isCut: c.type === 'cut' ? true : undefined,
  }));

  // Sort: tier ascending, then within-tier by [ownershipRank, -deltaScore, -inclusion, name].
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const ak = withinTierKey(a);
    const bk = withinTierKey(b);
    for (let i = 0; i < ak.length; i++) {
      const av = ak[i];
      const bv = bk[i];
      if (typeof av === 'number' && typeof bv === 'number') {
        if (av !== bv) return av - bv;
      } else if (typeof av === 'string' && typeof bv === 'string') {
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
    }
    return 0;
  });

  return ranked;
}
