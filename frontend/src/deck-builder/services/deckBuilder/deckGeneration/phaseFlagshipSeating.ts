import type { CoherenceRepair, DeckCategory, MaxRarity, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';
import { markUsed } from './state';
import { frontFaceName } from '@/lib/card-text';
import {
  validateCardRole,
  isProtectionPiece,
  isFreeInteraction,
} from '@/deck-builder/services/tagger/client';
import { calculateCardPriority } from '../cardPicking';
import {
  fitsColorIdentity,
  notInCollection,
  exceedsMaxPrice,
  exceedsMaxRarity,
  exceedsCmcCap,
  notOnArena,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
} from '../deckFilters';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import { routeCardByType, stampRoleSubtypes, roleCapTolerance } from '../categorize';
import type { BracketGuard } from '../bracketGuard';
import type { BudgetTracker } from '../budgetTracker';
import { LIFT_PICK_BOOST_MAX, LIFT_PICK_BOOST_SCALE } from '../packageBoost';
import {
  MUST_INCLUDE_BOOST,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
  COMBO_TRIM_BOOST,
  ROLE_DEFICIT_TRIM_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
} from './trimResistanceConstants';

// ── Flagship theme/axis seating (E103, iter-13) ──
//
// A commanderWantsX visibility boost (untap/blink/exile/extra-combat, see
// packageBoost.ts) is a flat, capped re-rank — +15 on top of the EDHREC
// pick-time priority score. That closes a marginal race, but the taxonomy's
// actual FLAGSHIP cards routinely sit 20-29 inclusion points below the
// staples they're competing against (Isshin: Helm of the Host at 17.9%
// inclusion / Aggravated Assault at 10.5% vs 37%+ incumbents), and no flat
// bonus that small can ever close that gap without the boost itself
// distorting every other race (E102's own measured failure — see board
// E103/E102 #1057). Closing a 20+ point gap needs an out-of-band seat, not a
// bigger re-rank.
//
// This is that seat: when a caller's gate fires (the same commanderWantsX
// boolean the boost already reads), reserve up to FLAGSHIP_SEAT_MAX slots for
// the caller's own top-ranked candidates — cards that already exist in the
// EDHREC pool and clear the SAME hard gates every other pick already clears
// (color identity, salt, game-changer cap, bracket ceiling, budget, rarity,
// CMC, Arena, the synergy-dependency guard, collection mode, role cap) — and
// displace the single lowest-survival-score incumbent for each seat, never a
// random tail card. Survival score reuses the same ingredients
// phaseLandSqueezeReconcile.ts's scoreOf already established for a deck-wide
// (cross-category) eviction: calculateCardPriority + scaled EDHREC lift + the
// shared trim-resistance protection tiers — deliberately NOT
// deckGenerator.ts's position-based computeTrimResistance, whose header notes
// pick position isn't comparable once curve-fit bonuses have scrambled it
// within a single category, let alone across all of them.
//
// Generic on purpose: `isFlagshipCandidate`/`gateFires`/`themeLabel` are
// caller-supplied, so a second taxonomy (the board's suggested "explicit
// theme selection → top High-Synergy pick" extension) is a new call with a
// different predicate, not a new displacement engine. Not wired up in E103 —
// no theme-selection caller exists yet — but the machinery underneath is
// already shared.
//
// Structural no-op — `{ seated: [] }`, state untouched — whenever `gateFires`
// is false (the overwhelming majority of decks, same as every other
// commanderWantsX boost) or no candidate both matches the predicate and
// clears every gate.

/** Hard cap: at most this many reserved seats per generation, regardless of
 *  how many candidates match. Keeps the mechanism a bounded re-rank, not a
 *  second picker. */
export const FLAGSHIP_SEAT_MAX = 2;

/** Minimum EDHREC inclusion % a candidate needs to compete for a reserved
 *  seat — comfortably below the real targets (Helm of the Host 17.9%,
 *  Aggravated Assault 10.5%) and well above 2%-inclusion taxonomy noise. */
export const FLAGSHIP_INCLUSION_FLOOR = 8;

export interface FlagshipSeatingContext {
  /** e.g. commanderWantsExtraCombat — false makes this pass fully inert. */
  gateFires: boolean;
  /** e.g. isExtraCombatPiece (tagger/client.ts). */
  isFlagshipCandidate: (card: ScryfallCard) => boolean;
  /** Short label for the disclosure reason, e.g. "extra combats". */
  themeLabel: string;
  scryfallCardMap: ReadonlyMap<string, ScryfallCard>;
  colorIdentity: readonly string[];
  liftScoreOf: (name: string) => number;
  roleTargets: Record<string, number> | null;
  isSaltBlocked?: (name: string) => boolean;
  cardAllowed?: (card: ScryfallCard) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerCount: { value: number };
  maxGameChangers: number;
  budgetTracker: BudgetTracker | null;
  maxCardPrice: number | null;
  maxRarity: MaxRarity;
  maxCmc: number | null;
  arenaOnly: boolean;
  currency: 'USD' | 'EUR';
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  collectionNames?: Set<string>;
  /** Collection strategies that constrain the pool (constrainsToCollection). */
  ownedOnly: boolean;
}

export interface FlagshipSeatingResult {
  seated: CoherenceRepair[];
}

export function applyFlagshipSeating(
  state: GenerationState,
  ctx: FlagshipSeatingContext
): FlagshipSeatingResult {
  if (!ctx.gateFires) return { seated: [] };
  const pool = state.edhrecData?.cardlists.allNonLand;
  if (!pool || pool.length === 0) return { seated: [] };

  const poolByName = new Map(pool.map((c) => [c.name, c]));
  const brewLevel = state.cfg.brewLevel;

  // Rank pool candidates matching the predicate, above the inclusion floor,
  // and not already seated somewhere in the deck — by the SAME
  // calculateCardPriority the pick phases already use, so "top candidate"
  // means what it means everywhere else in generation.
  const candidates = pool
    .filter((ec) => ec.inclusion >= FLAGSHIP_INCLUSION_FLOOR)
    .filter((ec) => !state.usedNames.has(ec.name) && !state.bannedCards.has(ec.name))
    .map((ec) => ctx.scryfallCardMap.get(ec.name))
    .filter((c): c is ScryfallCard => !!c && ctx.isFlagshipCandidate(c))
    .sort(
      (a, b) =>
        calculateCardPriority(poolByName.get(b.name)!, brewLevel) -
        calculateCardPriority(poolByName.get(a.name)!, brewLevel)
    );
  if (candidates.length === 0) return { seated: [] };

  const isRoleCapBlocked = (card: ScryfallCard): boolean => {
    if (!ctx.roleTargets) return false;
    const role = validateCardRole(card);
    if (!role) return false;
    const target = ctx.roleTargets[role] ?? 0;
    if (target <= 0) return false;
    return (state.currentRoleCounts[role] ?? 0) >= target + roleCapTolerance(target);
  };

  // Every gate a normal pick-time candidate already clears (mirrors
  // phaseCoherenceRepair.ts's findCandidate) — this is a re-rank, not a new
  // eligibility path.
  const clearsGates = (card: ScryfallCard): boolean => {
    if (!fitsColorIdentity(card, ctx.colorIdentity as string[])) return false;
    if (ctx.isSaltBlocked?.(card.name)) return false;
    if (ctx.cardAllowed && !ctx.cardAllowed(card)) return false;
    const isGC = state.gameChangerNames.has(card.name);
    if (isGC && ctx.gameChangerCount.value >= ctx.maxGameChangers) return false;
    if (ctx.bracketGuard?.exceedsCeiling(card.name)) return false;
    if (!isOwnedBudgetExempt(card.name, ctx.collectionNames, ctx.ignoreOwnedBudget)) {
      const cap = ctx.budgetTracker?.getEffectiveCap(ctx.maxCardPrice) ?? ctx.maxCardPrice;
      if (exceedsMaxPrice(card, cap, ctx.currency)) return false;
    }
    if (!isOwnedRarityExempt(card.name, ctx.collectionNames, ctx.ignoreOwnedRarity)) {
      if (exceedsMaxRarity(card, ctx.maxRarity)) return false;
    }
    if (exceedsCmcCap(card, ctx.maxCmc)) return false;
    if (notOnArena(card, ctx.arenaOnly)) return false;
    if (ctx.ownedOnly && notInCollection(card.name, ctx.collectionNames)) return false;
    if (isRoleCapBlocked(card)) return false;
    return true;
  };

  // Deck-wide "weakest incumbent" survival score — same ingredients as
  // phaseLandSqueezeReconcile.ts's scoreOf, reused rather than reinvented (see
  // header): calculateCardPriority + scaled lift + the shared trim-resistance
  // protection tiers. A displacement candidate that's a must-include, staple
  // rock, protection piece, free-interaction piece, combo piece, or a
  // role-deficit card is effectively unpickable — those boosts dwarf anything
  // this scan would otherwise consider.
  const survivalScore = (card: ScryfallCard): number => {
    const ec = poolByName.get(card.name);
    let score = ec ? calculateCardPriority(ec, brewLevel) : 0;
    score += Math.min(
      LIFT_PICK_BOOST_MAX,
      Math.max(0, ctx.liftScoreOf(card.name)) * LIFT_PICK_BOOST_SCALE
    );
    if (card.isMustInclude) score += MUST_INCLUDE_BOOST;
    if (card.isStapleRock || STAPLE_ROCK_NAMES.has(card.name)) score += STAPLE_PROTECTION_BOOST;
    if (isProtectionPiece(card)) score += PROTECTION_PIECE_BOOST;
    if (isFreeInteraction(card)) score += FREE_INTERACTION_BOOST;
    if (state.comboCardNames.has(card.name)) score += COMBO_TRIM_BOOST;
    if (ctx.roleTargets) {
      const role = validateCardRole(card);
      if (role) {
        const target = ctx.roleTargets[role] ?? 0;
        const current = state.currentRoleCounts[role] ?? 0;
        if (current <= target) score += ROLE_DEFICIT_TRIM_BOOST;
        else if (current >= target + 3) score += ROLE_SURPLUS_TRIM_PENALTY;
      }
    }
    return score;
  };

  const weakestVictim = (
    exclude: ReadonlySet<string>
  ): { card: ScryfallCard; category: DeckCategory } | null => {
    let best: { card: ScryfallCard; category: DeckCategory; score: number } | null = null;
    for (const cat of Object.keys(state.categories) as DeckCategory[]) {
      if (cat === 'lands') continue;
      for (const card of state.categories[cat]) {
        if (exclude.has(card.name)) continue;
        const score = survivalScore(card);
        if (!best || score < best.score) best = { card, category: cat, score };
      }
    }
    return best ? { card: best.card, category: best.category } : null;
  };

  const seated: CoherenceRepair[] = [];
  const seatedNames = new Set<string>();
  let seatsLeft = FLAGSHIP_SEAT_MAX;

  for (const candidate of candidates) {
    if (seatsLeft <= 0) break;
    if (!clearsGates(candidate)) continue;
    const victim = weakestVictim(seatedNames);
    if (!victim) break; // nothing left to displace — never happens on a real deck

    // Cut the victim (mirrors phaseCoherenceRepair.ts's removeCard).
    state.categories[victim.category] = state.categories[victim.category].filter(
      (c) => c !== victim.card
    );
    state.usedNames.delete(victim.card.name);
    if (victim.card.name.includes(' // ')) state.usedNames.delete(frontFaceName(victim.card.name));
    const victimRole = validateCardRole(victim.card);
    if (victimRole && state.currentRoleCounts[victimRole] > 0) {
      state.currentRoleCounts[victimRole]--;
    }

    // Seat the flagship candidate (mirrors phaseCoherenceRepair.ts's
    // addCard + commitAdd bookkeeping).
    stampRoleSubtypes(candidate);
    routeCardByType(candidate, state.categories);
    markUsed(state, candidate.name);
    const role = validateCardRole(candidate);
    if (role) state.currentRoleCounts[role] = (state.currentRoleCounts[role] ?? 0) + 1;
    if (state.gameChangerNames.has(candidate.name)) {
      candidate.isGameChanger = true;
      ctx.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(candidate.name);
    if (!isOwnedBudgetExempt(candidate.name, ctx.collectionNames, ctx.ignoreOwnedBudget)) {
      ctx.budgetTracker?.deductCard(candidate);
    }

    seatedNames.add(candidate.name);
    seatsLeft--;
    const inclusion = poolByName.get(candidate.name)?.inclusion;
    seated.push({
      cut: victim.card.name,
      added: candidate.name,
      reason:
        `${candidate.name} is a top ${ctx.themeLabel} card` +
        (typeof inclusion === 'number' ? ` (${inclusion.toFixed(1)}% of decks)` : '') +
        ` that the visibility boost alone couldn't outrank — reserved a seat for it.`,
    });
  }

  return { seated };
}
