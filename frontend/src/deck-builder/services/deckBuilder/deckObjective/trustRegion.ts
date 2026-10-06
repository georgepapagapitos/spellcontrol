/**
 * The search's trust region: what a swap must NOT do, however well it
 * scores. The first optimizer gate (2026-09-29) regressed 13 of 15 decks
 * while the objective agreed with the differ on the generator's own changes
 * 77% of the time: a free search found exactly the cards the score reads
 * wrong (tutors at their 12% inclusion, Boseiju as a land, Umbral Mantle as
 * an equipment with no role) and traded them for cards it reads right. The
 * score is a good judge of the decks the generator makes and a poor one of
 * the decks a search can reach. So a swap is a small, well-evidenced step
 * away from a deck the generator (and the page's players) already vouch for:
 *
 * 1. Protected cards, unless the move repairs a broken hard constraint:
 *    - a piece of a complete combo in the deck, and a tutor that finds one,
 *      never leave: the line is a plan, and the gate called every broken one
 *      a loss, even for a more popular card (Kozilek's Karn + Mycosynth
 *      Lattice for Thran Dynamo);
 *    - a protection piece (as its text bears it out: factsReading.ts), a
 *      land that is also interaction (Boseiju, Who Endures), a Game Changer
 *      (the deck's power, which a target of "any" keeps) and a staple
 *      (STAPLE_BAR% or more of the page's decks: the generator's staple
 *      bar, E532) leave only for a card played at least as often on this
 *      commander's page (its price-adjusted inclusion, the quality prior),
 *      each protected card matched to its own incoming card, and a Game
 *      Changer only for another.
 * 2. Role floors and caps. No swap takes ramp, draw, removal or wipes below
 *    the plan's target (or further below it), or raises one past its cap
 *    (the report's own: target + max(2, 20%)), counted the way the deck
 *    report counts them (`roleOf`), so the report never shows a role the
 *    search emptied or overfilled. A role the generator's surplus rebalance
 *    trimmed (a disclosed conversion) is capped where the rebalance left it.
 *    Class floors (classFloors.ts): the last answer of a kind, and any
 *    protection piece, never leave unless one of the same class comes in.
 * 3. A margin that grows with the distance from the page: a swap must gain
 *    `minGain` plus DRIFT × how much less played the incoming cards are
 *    (Σ out-quality − Σ in-quality, when positive). A popular card gives way
 *    to a less popular one only for a large, stated reason.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { countsAsRole, TIER_WEIGHT, type FactRole } from '@/deck-builder/services/cardFacts';
import { classFloorProblem } from './classFloors';
import {
  passesRoleCap,
  roleCapLimit,
  STAPLE_CEILING_BAND,
  STAPLE_INCLUSION_BAR,
} from '../roleCapAllowance';
import { isLandCard } from './context';
import {
  inclusionPct,
  isGameChanger,
  STRICT,
  synergyOf,
  type Protection,
  type ProtectedClass,
} from './protections';
import { OBJECTIVE_ROLES, type ObjectiveContext, type ObjectiveDeck } from './types';

// The protection set moved to protections.ts (E540 S3); these stay importable from here.
export {
  protectedCards,
  STAPLE_BAR,
  SIGNATURE_COUNT,
  SIGNATURE_MIN_PCT,
  inclusionPct,
} from './protections';
export type { Protection, ProtectedClass } from './protections';

export const DRIFT = 1;

export interface TrustOptions {
  /** Staple bar in percent. Default STAPLE_BAR. */
  stapleBar?: number;
  /** Margin per unit of quality given up. Default DRIFT. */
  drift?: number;
  /**
   * The role a card counts toward, as the deck report counts it (the harness
   * passes commanderDeckAnalysis's countedRoleOf). Default: the objective's
   * own card-facts reading (primary or secondary role, one per card).
   */
  roleOf?: (card: ScryfallCard) => string | null;
  /** classCounts() of the deck the move is made in; without it the class floors are not checked. */
  classesNow?: Readonly<Record<string, number>>;
  /** gameChangerCount() of the deck the move is made in; without it the bracket tier is not checked. */
  gameChangersNow?: number;
  /**
   * Roles the generator's surplus rebalance trimmed, by the count each was
   * left at: the search may not raise them again (that would undo a
   * disclosed conversion, Rampant Growth for Wrathful Red Dragon).
   */
  roleCeilings?: Readonly<Record<string, number>>;
}

/** What bound a move: a protected class, a role floor or cap, or a class floor. */
export type TrustBound =
  ProtectedClass | 'role floor' | 'role cap' | 'class floor' | 'bracket tier';

/** Game Changers at which the estimator floors a deck at bracket 4 (deck-metrics' hard floor). */
export const BRACKET_4_GAME_CHANGERS = 4;

/** How many Game Changers the deck holds. */
export function gameChangerCount(deck: ObjectiveDeck, ctx: ObjectiveContext): number {
  return deck.cards.filter((c) => isGameChanger(c, ctx)).length;
}

const FACT_ROLE: Partial<Record<FactRole, string>> = {
  ramp: 'ramp',
  cardDraw: 'cardDraw',
  removal: 'removal',
  boardwipe: 'boardwipe',
};

/** The objective's own one-role-per-card reading, used when no report counter is given. */
export function factsRoleOf(ctx: ObjectiveContext): (card: ScryfallCard) => string | null {
  return (card) => {
    if (isLandCard(card)) return null;
    let best: { role: string; w: number } | null = null;
    for (const f of ctx.factsOf(card).roles) {
      const role = FACT_ROLE[f.role];
      if (!role || !countsAsRole(f)) continue;
      const w = TIER_WEIGHT[f.tier];
      if (!best || w > best.w) best = { role, w };
    }
    return best?.role ?? null;
  };
}

/** Role counts of a deck under `roleOf`. */
export function countRoles(
  deck: ObjectiveDeck,
  roleOf: (card: ScryfallCard) => string | null
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of deck.cards) {
    const r = roleOf(c);
    if (r) counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

export interface TrustVerdict {
  /** Why the move is out of bounds, or null. */
  blocked: string | null;
  /** What bound it: a protected class or a role floor. */
  bound: TrustBound | null;
  /** The gain the move must reach. */
  required: number;
}

/**
 * Judge a move against the trust region. `protectedNow` is protectedCards()
 * of the current deck and `rolesNow` its countRoles(); a repair skips the
 * protections (a constraint forces the move) and keeps the margin at `minGain`.
 */
export function trustVerdict(
  rolesNow: Readonly<Record<string, number>>,
  outs: readonly ScryfallCard[],
  ins: readonly ScryfallCard[],
  ctx: ObjectiveContext,
  protectedNow: ReadonlyMap<string, Protection>,
  minGain: number,
  opts: TrustOptions & {
    repair?: boolean;
    /**
     * A forced repair (an unowned card an owned-only build can't keep): skip
     * the protected-card rule, whose "played as often" bar no owned card can
     * meet, and keep the role floors and caps and the bracket tier.
     */
    skipProtected?: boolean;
    /** Also skip the class floors (no owned card of the class exists). */
    skipClassFloor?: boolean;
  } = {}
): TrustVerdict {
  const drift = opts.drift ?? DRIFT;
  const lostQuality =
    outs.reduce((s, c) => s + ctx.qualityOf(c).q, 0) -
    ins.reduce((s, c) => s + ctx.qualityOf(c).q, 0);
  const required = minGain + drift * Math.max(0, lostQuality);
  if (opts.repair) return { blocked: null, bound: null, required: minGain };

  // Each protected card needs its own incoming card played at least as
  // often, read price-adjusted (context.ts: a $60 card's inclusion
  // understates how much its players want it), most played first. A Game
  // Changer's must itself be a Game Changer: the list is the bracket
  // system's measure of power, and trading one for an ordinary card lowers
  // the deck's tier (the first gate's Lathril and Meren fell from bracket 4).
  const isGc = (c: ScryfallCard) =>
    ctx.gameChangerNames.has(c.name) || ctx.gameChangerNames.has(c.name.split(' // ')[0]);
  const q = (c: ScryfallCard) => ctx.qualityOf(c).q;
  const free = [...ins].sort((a, b) => q(b) - q(a));
  const guarded = opts.skipProtected
    ? []
    : outs.filter((c) => protectedNow.has(c.name)).sort((a, b) => q(b) - q(a));
  for (const c of guarded) {
    const p = protectedNow.get(c.name)!;
    if (STRICT.has(p.cls)) {
      // A card that does the same job comes in (Coach's exempt swaps): not a loss.
      if (p.exempt && ins.some(p.exempt)) continue;
      return { blocked: `${c.name} is ${p.why}`, bound: p.cls, required };
    }
    // A Game Changer leaves only for another, whatever else it is: Fierce
    // Guardianship is a protection piece first (its class above), and went out
    // for a proliferate creature that way in the second gate.
    const needsGc = isGc(c);
    // A staple is matched on its page play rate itself: the price-adjusted
    // quality lets a cheap, less-played card replace a staple (Enchantress's
    // Presence, 87.6%, went for Sterling Grove, 78.7%, whose adjusted read was
    // higher), and an off-page card has no rate to match with.
    const played = (x: ScryfallCard) => (p.cls === 'staple' ? inclusionPct(x, ctx) : q(x));
    const asGood = (x: ScryfallCard) =>
      p.cls === 'signature'
        ? synergyOf(x, ctx) >= synergyOf(c, ctx) || inclusionPct(x, ctx) >= inclusionPct(c, ctx)
        : played(x) >= played(c);
    const match = free.findIndex((x) => asGood(x) && (!needsGc || isGc(x)));
    if (match < 0) {
      return {
        blocked: needsGc
          ? `${c.name} is a Game Changer, and no Game Changer played as often comes in`
          : `${c.name} is ${p.why}, and nothing coming in is played as often`,
        bound: p.cls,
        required,
      };
    }
    free.splice(match, 1);
  }

  const roleOf = opts.roleOf ?? ctx.roleOf ?? factsRoleOf(ctx);
  for (const role of OBJECTIVE_ROLES) {
    const target = ctx.roleTargets[role];
    if (!target) continue;
    const lose = outs.filter((c) => roleOf(c) === role).length;
    const gain = ins.filter((c) => roleOf(c) === role).length;
    const now = rolesNow[role] ?? 0;
    const after = now - lose + gain;
    if (gain > lose) {
      // The generator's own cap and allowance (roleCapAllowance.ts): past the
      // cap only staples pass (the staple bar), up to the staple ceiling.
      const ceiling = opts.roleCeilings?.[role];
      const gained = ins.filter((c) => roleOf(c) === role);
      const passing = gained.every((c) => passesRoleCap(inclusionPct(c, ctx), false));
      const cap =
        passing && ceiling === undefined
          ? roleCapLimit(target, STAPLE_CEILING_BAND)
          : Math.min(roleCapLimit(target), ceiling ?? Infinity);
      if (after > cap) {
        return {
          blocked: `${role} would rise to ${after}, past ${ceiling !== undefined && ceiling <= cap ? 'where the rebalance left it' : `its cap (${STAPLE_INCLUSION_BAR}% staples pass it)`} of ${cap}`,
          bound: 'role cap',
          required,
        };
      }
    }
    if (lose > gain && after < target) {
      return {
        blocked: `${role} would fall to ${after} of target ${target}`,
        bound: 'role floor',
        required,
      };
    }
  }
  // A deck built for "any" bracket keeps the power tier the generator gave it:
  // the gate's Isshin and Sythis went from bracket 3 to 4 on one more Game
  // Changer (Demonic Tutor, Serra's Sanctum) that no swap reason mentioned.
  if (opts.gameChangersNow !== undefined && typeof ctx.customization.targetBracket !== 'number') {
    const after =
      opts.gameChangersNow +
      ins.filter((c) => isGameChanger(c, ctx)).length -
      outs.filter((c) => isGameChanger(c, ctx)).length;
    if (opts.gameChangersNow < BRACKET_4_GAME_CHANGERS && after >= BRACKET_4_GAME_CHANGERS) {
      return {
        blocked: `it would make ${after} Game Changers, which reads as bracket 4`,
        bound: 'bracket tier',
        required,
      };
    }
  }
  if (opts.classesNow && !opts.skipClassFloor) {
    const problem = classFloorProblem(opts.classesNow, outs, ins, ctx);
    if (problem) return { blocked: problem, bound: 'class floor', required };
  }
  return { blocked: null, bound: null, required };
}
