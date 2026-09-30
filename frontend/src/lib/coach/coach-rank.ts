/**
 * Coach ranker — pure, deterministic tier assignment for the CoachFeed.
 *
 * A row is promoted by the sub-score its change actually moves, read from
 * what the change IS rather than which lane carries it:
 *   fill-gaps (a missing staple)      → roles when it has a role, and cardFit
 *                                       (unfilled staples are cardFit's gap term)
 *   upgrade "Fills <role> gap"        → roles, cardFit
 *   upgrade EDHREC pick (theme,
 *     synergy, curve play)            → cardFit
 *   upgrade synergy pick on an axis
 *     the deck is invested in         → strategy (the producer/payoff balance)
 *   upgrade synergy pick on a budding
 *     axis, or a land/fixing add      → nothing: tier 3
 *   collection (owned substitute)     → roles
 *   bracket-fit                       → cardFit
 *   budget, similar, lands, cuts      → always tier 3
 *   combos                            → tier 2 when the missing piece is owned
 *
 * T171 lane L measured the old mapping (every upgrade row → cardFit): an
 * off-plan "rewards cycling" pick for Atraxa rode a low cardFit into tier 1
 * over the staples the deck was missing, 93 times across the panel.
 *
 * Tier assignment:
 *   Tier 1: a roles/cardFit target below 60 (severe deficit), for fill-gaps
 *           and upgrade rows.
 *   Tier 2: a target that is the weakest non-partial sub-score and below 75.
 *   Tier 3: everything else.
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

/** Optimizer addition categories that add a land or fix colors: the manabase's business. */
const MANABASE_GROUPS = new Set(['mana-fix', 'flex-land', 'color-fix', 'color-rebalance']);

/** The sub-scores this change moves, strongest claim first. Empty = never promoted. */
export function changeTargets(c: Change): SubScoreKey[] {
  switch (c.lane) {
    case 'fill-gaps':
      return c.role ? ['roles', 'cardFit'] : ['cardFit'];
    case 'collection':
      return ['roles'];
    case 'bracket-fit':
      return ['cardFit'];
    case 'upgrade': {
      // A synergy pick carries its axis; the optimizer's picks carry a group.
      if (c.axis) return c.budding ? [] : ['strategy'];
      const group = c.group ?? '';
      if (MANABASE_GROUPS.has(group)) return [];
      if (group.startsWith('fills:')) return ['roles', 'cardFit'];
      return ['cardFit'];
    }
    default:
      return [];
  }
}

/** Tier-3-only lanes — budget saves money but is never a quality concern.
 *  Combos are NOT listed here anymore: an owned-piece combo completion is tier 2
 *  (tonight's "free win"); unowned combo pieces stay tier 3. */
const ALWAYS_TIER_3 = new Set<Change['lane']>(['budget', 'similar', 'lands']);

/**
 * Within a tier, what the row is for: 0 = a move that makes the deck better,
 * 1 = a synergy pick that would start a new engine, or a budget swap (it
 * saves money and its play rate is the cheaper card's, so it can't outrank a
 * staple on that number).
 */
function planBand(c: Change): number {
  return c.budding || c.lane === 'budget' ? 1 : 0;
}

/**
 * Rank a flat list of Changes into tier-ordered RankedMoves.
 *
 * Within-tier order: owned < in-other-deck < unowned/undefined, then on-plan
 * before budding, then EDHREC inclusion descending (the one signal every add
 * lane shares), then deltaScore descending (undefined = 0; only land swaps
 * carry it, on their own scale, so it only breaks ties), then name ascending.
 *
 * Cuts are always tier 3 and marked with isCut:true. They read weakest first:
 * spells before land tuning, then inclusion ASCENDING (the old shared key put
 * the most-played flagged card at the top of the Cuts chip).
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

  const scoreOf = (key: SubScoreKey): number | undefined => {
    const sub = planScore?.subscores[key];
    return sub?.partial ? undefined : sub?.value;
  };

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

    const targets = changeTargets(c);
    if (targets.length === 0) return 3;

    // Tier 1: severe structural gap (< 60) for fill-gaps or upgrade.
    if (
      (c.lane === 'fill-gaps' || c.lane === 'upgrade') &&
      targets.some((k) => k !== 'strategy' && (scoreOf(k) ?? Infinity) < 60)
    ) {
      return 1;
    }

    // Tier 2: a target sub-score is the weakest AND < 75.
    if (weakestKey !== null && targets.includes(weakestKey) && weakestValue < 75) {
      return 2;
    }

    return 3;
  }

  function withinTierKey(r: RankedMove): [number, number, number, number, string] {
    const oRank = ownershipRank(r.change);
    const incl = r.change.inclusion ?? -1;
    // Cuts read weakest first: spells before land tuning (a basic-for-basic
    // rebalance is not a card the deck is worse for running), then the least
    // played here, a card missing from the commander's page first.
    if (r.change.type === 'cut') {
      return [oRank, 0, /\bland\b/i.test(r.change.typeLine ?? '') ? 1 : 0, incl, r.change.name];
    }
    const dScore = r.change.deltaScore ?? 0;
    return [oRank, planBand(r.change), -incl, -dScore, r.change.name];
  }

  const ranked: RankedMove[] = changes.map((c) => ({
    change: c,
    tier: assignTier(c),
    isCut: c.type === 'cut' ? true : undefined,
  }));

  // Sort: tier ascending, then within-tier by the key above.
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

/**
 * What makes two rows read as "the same suggestion again". Combo completions
 * share their partner set: eight owned cards that each complete
 * "Krenko + Skirk Prospector → …" are eight rows with one idea. Every other
 * lane is never deferred.
 */
export function diversityKey(c: Change): string | null {
  if (c.lane !== 'combos' || !c.reason) return null;
  return c.reason.split(' → ')[0];
}

/**
 * Let a diversity key appear at most `cap` times in ranked order; every later
 * row with that key is deferred to the END of the list, in its original order.
 * Deliberately not per-tier: a deck with four owned combo lines and thirty
 * unowned gap fills has a tier 2 made entirely of combos, so deferring within
 * the tier brought the repeats straight back into the first fold. "Another
 * card that completes the combo you already saw twice" is worth less than a
 * different idea from a lower tier, so the repeats go behind "Show all".
 */
export function diversifyRankedMoves(moves: RankedMove[], cap = 2): RankedMove[] {
  const seen = new Map<string, number>();
  const kept: RankedMove[] = [];
  const deferred: RankedMove[] = [];
  for (const m of moves) {
    const key = diversityKey(m.change);
    if (key === null) {
      kept.push(m);
      continue;
    }
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    (n < cap ? kept : deferred).push(m);
  }
  return [...kept, ...deferred];
}
