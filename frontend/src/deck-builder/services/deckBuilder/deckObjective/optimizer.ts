/**
 * The whole-deck search (E513): start from a finished deck (the generator's)
 * and improve it a few swaps at a time, every swap judged against the WHOLE
 * deck by the objective, hard constraints enforced on every move, and every
 * move kept inside a trust region (trustRegion.ts). Generation-inert:
 * nothing in the generator calls it yet.
 *
 *   optimizeDeck(seed, candidates, ctx, opts) → { deck, score, swaps, ... }
 *
 * DO NO HARM. The first gate of this search (2026-09-29, the standard 15)
 * regressed 13 decks: with 25 swaps a deck and a 0.1 margin, it found the
 * cards the score misreads and traded them away. So now:
 *  - at most MAX_SWAPS (5) swaps besides repairs, each gaining MIN_GAIN (0.3 card-
 *    equivalents, twice the goldfish's per-swap noise) plus a margin for
 *    every point of page popularity it gives up;
 *  - protected cards (combo pieces, their tutors, protection, Game
 *    Changers, staples) leave only for a card played at least as often, and
 *    a Game Changer only for another;
 *  - no swap takes a role below its target or past its cap, or takes the
 *    last answer of a class (stack, creature, ...) or a protection piece
 *    without one of the same class coming in;
 *  - a repair of a broken constraint keeps to all of that when any repair
 *    can, and brings in a card of the slot's role and tier before any other;
 *  - after the search, every swap is re-judged in the FINAL deck and undone
 *    when it no longer pays its margin there, and every swap's reasons are
 *    read from the final deck, so a reason never names a card a later swap
 *    removed.
 *
 * Moves: 1:1 swaps within a slot class (a spell for a spell, a nonbasic land
 * for a nonbasic land, a basic for a basic, so the land count and the
 * nonbasic count the plan chose stay put), and 2:2 swaps that seat both
 * missing pieces of a two-piece combo from the context's combo set.
 * Never moved: the commander (never in the 99), must-includes, the staple
 * rocks every phase of the generator protects by name (Sol Ring, Arcane
 * Signet), and `locks`.
 *
 * Search: first-improvement hill climbing, cheapest-to-judge first.
 *  1. Every removable card's loss and every candidate's gain are read with the
 *     FAST terms (all but the two simulated ones, mana and winline).
 *  2. Pairs are ranked by gain − loss; the best `shortlist` inside the trust
 *     region are checked with the fast terms, and a pair that clears FAST_GATE
 *     of its margin is scored in full (both simulations, the library laid out
 *     in the current deck's slots, so the two decks play the same shuffled
 *     positions). The first whose full gain clears its margin is applied.
 *  3. While the deck breaks a hard constraint, moves that repair it come
 *     first and are taken whatever they cost (a constraint is the user's).
 *
 * Deterministic: every ordering breaks ties by name, the goldfish seeds are
 * the context's, and the budgets count evaluations, not milliseconds. The
 * wall-clock cap is a safety net; hitting it is reported (`stoppedBy: 'time'`)
 * because it makes the result depend on the machine.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { normalizeCardName } from '../cardIdentity';
import { classCounts } from './classFloors';
import {
  bracketFloorOf,
  cardIneligibility,
  checkConstraints,
  isOwnedCard,
  requiresOwnedCards,
} from './constraints';
import { isBasicLand, isLandCard } from './context';
import { reasonProblem } from './reasonCheck';
import { protectionValue } from './terms/interaction';
import {
  reasonsFor,
  rolesMovedBetween,
  summaryOf,
  type AppliedSwap,
  type SwapReason,
} from './swapReasons';
import { TERMS, compareScores, infeasibility, scoreDeck, termDeltas } from './index';
import {
  countRoles,
  factsRoleOf,
  gameChangerCount,
  protectedCards,
  trustVerdict,
  type TrustOptions,
} from './trustRegion';
import {
  TERM_KEYS,
  type ConstraintViolation,
  type ObjectiveContext,
  type ObjectiveDeck,
  type ObjectiveScore,
  type TermKey,
} from './types';

/** The two terms that simulate games; everything else is cheap. */
export const SLOW_TERMS: readonly TermKey[] = ['mana', 'winline'];
export const FAST_TERMS: readonly TermKey[] = TERM_KEYS.filter((k) => !SLOW_TERMS.includes(k));

export type { AppliedSwap, SwapReason };

export interface OptimizeOptions {
  /** Card names that must stay (in addition to the customization's must-includes). */
  locks?: readonly string[];
  /** Stop after this many applied swaps, repairs of a broken constraint not counted. Default MAX_SWAPS. */
  maxSwaps?: number;
  /** Stop after this many FULL scores (the expensive evaluations). Default 300. */
  maxEvaluations?: number;
  /** A move must gain at least this much, in card-equivalents. Default MIN_GAIN. */
  minGain?: number;
  /** Fast-judged pairs per step. Default 40. */
  shortlist?: number;
  /** Local-optimum escapes. Default 0 (a trust region doesn't wander). */
  escapes?: number;
  /** An escape may cost at most this much. Default 0.3. */
  escapeTolerance?: number;
  /** Swaps a move stays tabu for. Default 6. */
  tabuTenure?: number;
  /** Seat both missing pieces of a two-piece combo in one move. Default true. */
  comboPairs?: boolean;
  /** Safety cap in milliseconds. Default 10 minutes. */
  timeBudgetMs?: number;
  /** The trust region's settings, or false to search without it (the first gate's search). */
  trust?: TrustOptions | false;
  /**
   * Candidates that may come in only to repair a broken constraint: the rest
   * of an owned collection, fetched so an unowned card in an owned-only build
   * has an owned replacement. They carry no page evidence for this commander,
   * so they don't compete with the page's cards for an improving swap.
   */
  repairOnly?: ReadonlySet<string>;
  /**
   * Constraint checks the search must not repair: an ownership rule the
   * generator shipped relaxed and disclosed. The search is never stricter than
   * the generator was. Moves still may not make them worse.
   */
  leave?: ReadonlySet<string>;
}

export interface OptimizeResult {
  deck: ObjectiveDeck;
  score: ObjectiveScore;
  seedScore: ObjectiveScore;
  swaps: AppliedSwap[];
  /** Swaps the search made and then undid: the final deck no longer paid their margin. */
  undone: Array<Pick<AppliedSwap, 'out' | 'in' | 'delta'> & { why: string }>;
  /** Reasons dropped from kept swaps because the deck or the cards' text don't bear them out. */
  unverified: Array<{ name: string; term: TermKey; note: string; problem: string }>;
  /** Moves the trust region refused, by what it protected. */
  refusals: Record<string, number>;
  evaluations: { fast: number; full: number };
  stoppedBy: 'local-optimum' | 'max-swaps' | 'max-evaluations' | 'time' | 'no-candidates';
  ms: number;
}

/**
 * The slot a card fills, as a repair reads it: its counted role, or
 * 'protection' for a protection piece (the report counts no such role, and an
 * owned-only build's Swiftfoot Boots is the card most often repaired).
 */
export function repairSlotOf(
  card: ScryfallCard,
  ctx: Pick<ObjectiveContext, 'factsOf'>,
  roleOf: (card: ScryfallCard) => string | null
): string | null {
  return roleOf(card) ?? (protectionValue(card, ctx.factsOf(card)) > 0 ? 'protection' : null);
}

/** Runs the search to the end without waiting. */
export function optimizeDeck(
  seed: ObjectiveDeck,
  candidates: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: OptimizeOptions = {}
): OptimizeResult {
  const steps = optimizeSteps(seed, candidates, baseCtx, options);
  for (let next = steps.next(); ; next = steps.next()) if (next.done) return next.value;
}

/** Swaps a deck. Five: a finished deck needs a few corrections, not a rebuild. */
export const MAX_SWAPS = 5;
/**
 * The margin a swap must clear, in card-equivalents: about twice the mana
 * term's standard deviation on a one-card swap with common random numbers
 * (0.155, context.ts), so a swap is never taken on goldfish noise.
 */
export const MIN_GAIN = 0.3;
const DEFAULTS = {
  maxSwaps: MAX_SWAPS,
  maxEvaluations: 300,
  minGain: MIN_GAIN,
  shortlist: 40,
  escapes: 0,
  escapeTolerance: 0.3,
  tabuTenure: 6,
  comboPairs: true,
  timeBudgetMs: 600_000,
};
/**
 * The generator's name-protected staple rocks (deckGeneration/
 * phaseStapleManaRocks.ts STAPLE_ROCK_NAMES; a test pins the two lists
 * equal). Copied, not imported: the objective never reaches the generator
 * (layering.test.ts).
 */
export const STAPLE_ROCKS: readonly string[] = ['Sol Ring', 'Arcane Signet'];

/** A pair is scored in full once its fast gain reaches this share of its margin. */
const FAST_GATE = 0.5;
/** Repairs of a broken constraint compared before the least damaging one is taken. */
const REPAIR_CHOICES = 8;
/** A repair's card comes in at least this share as played as the card it replaces, when one can. */
const REPAIR_TIER = 0.5;
/**
 * Repairs kept aside, per tier, because they leave the trust region, judged
 * only when none stays inside it. As many as the checks reach (a step checks
 * at most shortlist x CHECKS_PER_SLOT moves), so the best-played owned card is
 * picked from all of them, not from the first by estimate.
 */
const FORCED_KEPT = 1000;
type ForcedTier = 1 | 2 | 3;
/** What a forced repair that left the trust region says, so the reason owns up to it. */
function forcedDisclosure(tier: ForcedTier, why: string): string {
  return tier === 2
    ? `no owned card keeps the class floor (${why})`
    : `no owned card fits inside the role limits (${why})`;
}
/** Constraint checks allowed per shortlist slot before a step gives up. */
const CHECKS_PER_SLOT = 25;

const key = (name: string) => normalizeCardName(frontFaceName(name));

type SlotClass = 'spell' | 'land' | 'basic';
function slotClass(card: ScryfallCard): SlotClass {
  if (isBasicLand(card)) return 'basic';
  return isLandCard(card) ? 'land' : 'spell';
}
const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Σ weight × value over some terms. */
function partialTotal(
  deck: ObjectiveDeck,
  ctx: ObjectiveContext,
  keys: readonly TermKey[]
): number {
  let t = 0;
  for (const k of keys) if (ctx.weights[k] !== 0) t += ctx.weights[k] * TERMS[k](deck, ctx).value;
  return t;
}

interface Move {
  out: number[]; // indices into the current deck
  in: ScryfallCard[];
  kind: 'improve' | 'combo';
  estimate: number;
}

function applyMove(deck: ObjectiveDeck, move: Pick<Move, 'out' | 'in'>): ObjectiveDeck {
  const cards = [...deck.cards];
  move.out.forEach((i, j) => (cards[i] = move.in[j]));
  return { commanders: deck.commanders, cards };
}

/** The report's role counter, memoized by name (it is asked about the same cards every step). */
function memoRoleOf(
  roleOf: (card: ScryfallCard) => string | null
): (card: ScryfallCard) => string | null {
  const memo = new Map<string, string | null>();
  return (card) => {
    let r = memo.get(card.name);
    if (r === undefined) {
      r = roleOf(card);
      memo.set(card.name, r);
    }
    return r;
  };
}

/** What the search reports at each checkpoint. */
export interface Beat {
  swaps: number;
  evaluations: number; // full scores spent, of maxEvaluations
  maxEvaluations: number;
}

/**
 * The search as a generator: a Beat at every checkpoint, so a driver can let
 * the page breathe (optimizeDeckAsync, optimizerAsync.ts) or not (optimizeDeck
 * below). Same steps either way, so the same swaps. `meter.idle` is the time
 * the driver spent waiting, which the time budget does not count.
 */
export function* optimizeSteps(
  seed: ObjectiveDeck,
  candidates: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: OptimizeOptions = {},
  meter: { idle: number } = { idle: 0 }
): Generator<Beat, OptimizeResult, void> {
  const opts = { ...DEFAULTS, ...options };
  // Ownership rules the generator shipped relaxed and disclosed are left as
  // they are: only a violation outside this set is repaired.
  const ownedOnly = requiresOwnedCards(baseCtx);
  const leave = opts.leave ?? new Set<string>();
  const repairable = (vs: readonly ConstraintViolation[]) =>
    vs.reduce((n, v) => n + (leave.has(v.check) ? 0 : v.magnitude), 0);
  const trust = opts.trust === false ? null : (opts.trust ?? {});
  const roleOf = memoRoleOf(trust?.roleOf ?? baseCtx.roleOf ?? factsRoleOf(baseCtx));
  const t0 = Date.now();
  const worked = () => Date.now() - t0 - meter.idle;
  const cz = baseCtx.customization;
  // A staple rock yields to the user's ownership rule only where an unowned
  // one must break it: owned-only builds (E509 ruling (a): Sol Ring is
  // correctly absent there). Under an owned SHARE, even 100%, the generator
  // keeps one it seated and discloses the shortfall (Yuriko at 99% kept Sol
  // Ring), and so does the search: a share is met by cards that aren't
  // staples, or not at all (E513 round 3). Combo-sourced temporary must-includes are the generator's
  // bookkeeping, skipped silently by design (deckInvariants), so they are
  // not protected.
  const strategy = cz.collectionStrategy ?? 'full';
  const ownershipBinds =
    !!baseCtx.ownedNames &&
    cz.collectionMode !== false &&
    (strategy === 'full' || strategy === 'available');
  const stapleProtected = STAPLE_ROCKS.filter(
    (n) =>
      !ownershipBinds || baseCtx.ownedNames!.has(n) || baseCtx.ownedNames!.has(frontFaceName(n))
  );
  const protectedKeys = new Set(
    [...(cz.mustIncludeCards ?? []), ...stapleProtected, ...(opts.locks ?? [])].map(key)
  );
  const commanderKeys = new Set(seed.commanders.map((c) => key(c.name)));

  // Candidates: eligible one by one, not a commander, one entry per name
  // (basics stay addable while in the deck: they may repeat).
  const seen = new Set<string>();
  const pool = [...candidates]
    .filter((c) => {
      const k = key(c.name);
      if (seen.has(k) || commanderKeys.has(k)) return false;
      seen.add(k);
      return cardIneligibility(c, baseCtx) === null;
    })
    .sort(byName);

  let current = seed;
  const withSlots = (deck: ObjectiveDeck): ObjectiveContext => ({
    ...baseCtx,
    slotOrder: deck.cards.map((c) => c.name),
  });
  let ctx = withSlots(current);
  const evaluations = { fast: 0, full: 0 };
  const full = (deck: ObjectiveDeck, c: ObjectiveContext = ctx) => {
    evaluations.full++;
    return scoreDeck(deck, c);
  };
  const fast = (deck: ObjectiveDeck) => {
    evaluations.fast++;
    return partialTotal(deck, ctx, FAST_TERMS);
  };

  const seedScore = full(current);
  let currentScore = seedScore;
  let best = { deck: current, score: currentScore };
  const applied: Array<{
    out: ScryfallCard[];
    in: ScryfallCard[];
    kind: AppliedSwap['kind'];
    disclosure?: string;
  }> = [];
  const refusals: Record<string, number> = {};
  const beat = (): Beat => ({
    swaps: applied.length,
    evaluations: evaluations.full,
    maxEvaluations: opts.maxEvaluations,
  });
  const tabuOut = new Map<string, number>(); // key -> swap index until which it can't leave
  const tabuIn = new Map<string, number>(); // key -> swap index until which it can't return
  let escapesLeft = opts.escapes;
  let stoppedBy: OptimizeResult['stoppedBy'] = 'local-optimum';
  if (pool.length === 0) stoppedBy = 'no-candidates';

  while (pool.length > 0) {
    // Repairs don't count: a broken constraint is fixed however many swaps
    // it takes (an owned-only build can start six cards out of its pool).
    // Past the cap, the search goes on only to repair.
    const capped = applied.filter((a) => a.kind !== 'repair').length >= opts.maxSwaps;
    if (capped && repairable(currentScore.violations) === 0) {
      stoppedBy = 'max-swaps';
      break;
    }
    if (evaluations.full >= opts.maxEvaluations) {
      stoppedBy = 'max-evaluations';
      break;
    }
    if (worked() > opts.timeBudgetMs) {
      stoppedBy = 'time';
      break;
    }
    yield beat();
    const step = applied.length;
    const inDeck = new Set(current.cards.map((c) => key(c.name)));
    const fastNow = fast(current);
    const protectedNow = trust ? protectedCards(current, ctx, trust.stapleBar) : new Map();
    const rolesNow = trust ? countRoles(current, roleOf) : {};
    const classesNow = trust ? classCounts(current, ctx) : {};
    const gameChangersNow = trust ? gameChangerCount(current, ctx) : 0;

    // 1. What each removable card is worth here, and what each candidate would add.
    const removable = current.cards
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) => !protectedKeys.has(key(c.name)) && (tabuOut.get(key(c.name)) ?? -1) < step
      );
    const lossOf = new Map<number, number>();
    const lossByName = new Map<string, number>();
    for (const { c, i } of removable) {
      // Copies of one card (basics) are worth the same: judge the name once.
      let loss = lossByName.get(c.name);
      if (loss === undefined) {
        const without = {
          commanders: current.commanders,
          cards: current.cards.filter((_, j) => j !== i),
        };
        loss = fastNow - fast(without);
        lossByName.set(c.name, loss);
        yield beat();
      }
      lossOf.set(i, loss);
    }
    const addable = pool.filter(
      (c) =>
        (isBasicLand(c) || !inDeck.has(key(c.name))) &&
        (tabuIn.get(key(c.name)) ?? -1) < step &&
        (!ownedOnly || isOwnedCard(c, ctx))
    );
    const gainOf = new Map<ScryfallCard, number>();
    for (const c of addable) {
      gainOf.set(
        c,
        fast({ commanders: current.commanders, cards: [...current.cards, c] }) - fastNow
      );
      yield beat();
    }

    // 2. Rank 1:1 pairs within a slot class, plus 2:2 combo seatings.
    const moves: Move[] = [];
    const outsByClass = (cls: SlotClass) =>
      removable
        .filter(({ c }) => slotClass(c) === cls)
        .sort((a, b) => lossOf.get(a.i)! - lossOf.get(b.i)! || byName(a.c, b.c) || a.i - b.i);
    for (const cls of ['spell', 'land', 'basic'] as const) {
      const outs = outsByClass(cls);
      // One representative slot per card name (the weakest copy).
      const seenOut = new Set<string>();
      const uniqueOuts = outs.filter(({ c }) => !seenOut.has(c.name) && seenOut.add(c.name));
      const ins = addable.filter((c) => slotClass(c) === cls);
      for (const o of uniqueOuts) {
        for (const c of ins) {
          if (c.name === o.c.name) continue;
          moves.push({
            out: [o.i],
            in: [c],
            kind: 'improve',
            estimate: gainOf.get(c)! - lossOf.get(o.i)!,
          });
        }
      }
    }
    if (opts.comboPairs) {
      // The two weakest spells the trust region lets go.
      const outs = outsByClass('spell').filter(({ c }) => !protectedNow.has(c.name));
      for (const combo of baseCtx.combos ?? []) {
        if (combo.cards.length < 2) continue;
        const missing = combo.cards.filter(
          (n) => !inDeck.has(key(n)) && !commanderKeys.has(key(n))
        );
        if (missing.length !== 2) continue;
        const ins = missing.map((n) => addable.find((c) => key(c.name) === key(n)));
        if (ins.some((c) => !c || isLandCard(c))) continue;
        const two = outs.slice(0, 2);
        if (two.length < 2) continue;
        moves.push({
          out: two.map((o) => o.i),
          in: ins as ScryfallCard[],
          kind: 'combo',
          estimate:
            (ins as ScryfallCard[]).reduce((s, c) => s + gainOf.get(c)!, 0) -
            two.reduce((s, o) => s + lossOf.get(o.i)!, 0),
        });
      }
    }
    const curInfeasible = infeasibility(currentScore);
    const curRepairable = repairable(currentScore.violations);
    // Constraints come first, as in compareScores: while the deck breaks one,
    // moves that take out a card a violation names (an unowned card in an
    // owned-only build, a Game Changer over the bracket's ceiling, a combo
    // piece over the bracket's floor), or that trade an unowned card for an
    // owned one under an owned share, or a dearer card for a cheaper one over
    // budget, are judged before any other.
    const repairs = (m: Move): boolean => {
      if (curRepairable === 0) return false;
      for (const v of currentScore.violations) {
        if (leave.has(v.check)) continue;
        const outs = m.out.map((i) => current.cards[i]);
        if (outs.some((c) => v.cards.includes(c.name))) return true;
        if (v.check === 'owned-share' && ctx.ownedNames) {
          const owned = (c: ScryfallCard) =>
            ctx.ownedNames!.has(c.name) || ctx.ownedNames!.has(frontFaceName(c.name));
          // The share is over NONLAND cards: a land swap can't move it.
          if (outs.some((c) => !isLandCard(c) && !owned(c)) && m.in.every(owned)) return true;
        }
        if (v.check === 'budget') {
          const currency = cz.currency ?? 'USD';
          const cost = (cards: ScryfallCard[]) =>
            cards.reduce((s, c) => s + (parseFloat(getCardPrice(c, currency) ?? '') || 0), 0);
          if (cost(m.in) < cost(outs)) return true;
        }
      }
      return false;
    };
    const repairFirst = new Map(moves.map((m) => [m, repairs(m)]));
    // A repair fills the slot it empties when it can: once the least damaging
    // repair has picked the card to take out, a card of that card's counted
    // role (an owned removal spell for an unowned Swords to Plowshares, an
    // owned protection piece for Swiftfoot Boots) replaces it if any does.
    // Only the replacement is steered: which card leaves stays the least
    // damaging choice (ranked first, a matching role would cut an unowned
    // Sakura-Tribe Elder for a weaker owned rock under an owned share that any
    // unowned card's exit repairs).
    const slotOf = (c: ScryfallCard) => repairSlotOf(c, ctx, roleOf);
    const factsRole = factsRoleOf(ctx);
    const sameRole = new Map(
      moves.map((m) => [
        m,
        repairFirst.get(m)! &&
          m.out.every((i, j) => {
            const r = slotOf(current.cards[i]);
            // The report's role counts Waste Not as ramp; its text adds mana only when
            // an opponent discards, so the card's own facts have to agree.
            return (
              r !== null &&
              m.in[j] !== undefined &&
              slotOf(m.in[j]) === r &&
              (r === 'protection' || factsRole(m.in[j]) === r)
            );
          }),
      ])
    );
    moves.sort(
      (a, b) =>
        Number(repairFirst.get(b)) - Number(repairFirst.get(a)) ||
        b.estimate - a.estimate ||
        a.in
          .map((c) => c.name)
          .join('|')
          .localeCompare(b.in.map((c) => c.name).join('|')) ||
        a.out[0] - b.out[0]
    );

    // 3. Judge the best candidates exactly, cheapest first.
    let taken: {
      move: Move;
      score: ObjectiveScore;
      kind: AppliedSwap['kind'];
      disclosure?: string;
    } | null = null;
    let bestTried: { move: Move; score: ObjectiveScore } | null = null;
    // The shortlist counts moves inside every bound: under a budget the
    // best-estimated pairs are often the ones that break it, and skipping
    // them must not use up the step. The checks themselves are capped.
    let judged = 0;
    let checked = 0;
    let bestRepair: { move: Move; score: ObjectiveScore } | null = null;
    let repairsSeen = 0;
    // Repairs that leave the trust region: the constraint is the user's, so
    // one is taken when none stays inside it, never before.
    // They are kept in tiers (below): a forced repair still keeps whatever
    // of the region an owned card can keep.
    const forced: Move[] = [];
    const forcedKept = [0, 0, 0, 0];
    let forcedRepair = false;
    let forcedTier: ForcedTier = 1;
    const judgeOf = (
      move: Move,
      repair: boolean,
      relax: { skipProtected?: boolean; skipClassFloor?: boolean } = {}
    ) =>
      trustVerdict(
        rolesNow,
        move.out.map((i) => current.cards[i]),
        move.in,
        ctx,
        protectedNow,
        opts.minGain,
        { ...trust!, roleOf, classesNow, gameChangersNow, repair, ...relax }
      );
    // The least a forced repair gives up: 1 keeps the role floors and caps and
    // the class floors (an owned protection piece for Swiftfoot Boots), 2
    // keeps the caps and the floors but not the class (no owned card holds
    // it), 3 is over a cap or floor too (nothing owned fits under it).
    // Which forced repairs are judged first: the best-played owned card (the
    // user's ruling), and among the protection pieces that keep the class the
    // cheapest (Soul of New Phyrexia, six mana, took Lightning Greaves's slot).
    const moveQ = (m: Move) => m.in.reduce((t, c) => t + ctx.qualityOf(c).q, 0);
    const moveCmc = (m: Move) => m.in.reduce((t, c) => t + (c.cmc ?? 0), 0);
    const bestPlayed = (a: Move, b: Move) =>
      (forcedTier === 1 ? moveCmc(a) - moveCmc(b) : 0) || moveQ(b) - moveQ(a);
    // A forced repair never seats a card the bracket estimator floors higher
    // (Winter Moon is mass land denial: a deck's bracket is not the user's
    // ownership rule to trade away), read by the estimator's own floors.
    let floorNow: number | null = null;
    const raisesBracket = (m: Move) => {
      floorNow ??= bracketFloorOf(current, ctx);
      return bracketFloorOf(applyMove(current, m), ctx) > floorNow;
    };
    const tiers = new Map<Move, { tier: ForcedTier; why: string | null }>();
    const tierOf = (move: Move) => {
      let t = tiers.get(move);
      if (!t) {
        const keepsClass = judgeOf(move, false, { skipProtected: true });
        if (!keepsClass.bound) t = { tier: 1, why: null };
        else {
          const keepsCaps = judgeOf(move, false, { skipProtected: true, skipClassFloor: true });
          t = keepsCaps.bound
            ? { tier: 3, why: keepsCaps.blocked }
            : { tier: 2, why: keepsClass.blocked };
        }
        tiers.set(move, t);
      }
      return t;
    };
    for (const move of moves) {
      yield beat();
      if (judged >= opts.shortlist || checked >= opts.shortlist * CHECKS_PER_SLOT) break;
      if (evaluations.full >= opts.maxEvaluations || worked() > opts.timeBudgetMs) break;
      const next = applyMove(current, move);
      checked++;
      const violations = checkConstraints(next, ctx);
      const nextInfeasible = violations.reduce((s, v) => s + v.magnitude, 0);
      if (nextInfeasible > curInfeasible) continue;
      const isRepair = repairable(violations) < curRepairable;
      if (!isRepair && opts.repairOnly && move.in.some((c) => opts.repairOnly!.has(c.name)))
        continue;
      let required = opts.minGain;
      if (trust) {
        const verdict = judgeOf(move, false);
        if (verdict.bound) {
          if (isRepair) {
            if (raisesBracket(move)) continue;
            const tier = tierOf(move).tier;
            if (forcedKept[tier] < FORCED_KEPT) {
              forcedKept[tier]++;
              forced.push(move);
            }
          } else refusals[verdict.bound] = (refusals[verdict.bound] ?? 0) + 1;
          continue;
        }
        required = verdict.required;
      }
      judged++;
      const fastGain = fast(next) - fastNow;
      if (!isRepair && fastGain < FAST_GATE * required) continue;
      const score = full(next);
      if (!bestTried || compareScores(score, bestTried.score) > 0) bestTried = { move, score };
      if (isRepair) {
        // A repair is forced, so it is the least damaging one: the best of
        // the first REPAIR_CHOICES that fix the break, not the first found
        // (Swiftfoot Boots in an owned-only row went to Soul Net that way).
        if (!bestRepair || compareScores(score, bestRepair.score) > 0) {
          bestRepair = { move, score };
        }
        if (++repairsSeen >= REPAIR_CHOICES) break;
        continue;
      }
      // While the deck breaks a constraint, only a repair is taken; past the
      // cap, nothing else is.
      if (bestRepair || capped || forced.length > 0) continue;
      if (score.total - currentScore.total >= required) {
        taken = { move, score, kind: move.kind };
        break;
      }
    }
    if (!taken && !bestRepair && forced.length > 0) {
      // No repair keeps to the trust region: the least damaging one that
      // doesn't, as before the region reached repairs.
      forcedRepair = true;
      let seen = 0;
      forcedTier = Math.min(...forced.map((m) => tierOf(m).tier)) as ForcedTier;
      for (const move of forced.filter((m) => tierOf(m).tier === forcedTier).sort(bestPlayed)) {
        if (evaluations.full >= opts.maxEvaluations || worked() > opts.timeBudgetMs) break;
        yield beat();
        const score = full(applyMove(current, move));
        if (!bestRepair || compareScores(score, bestRepair.score) > 0) bestRepair = { move, score };
        if (++seen >= REPAIR_CHOICES) break;
      }
    }
    // The repair's card fills the slot it empties: a card of that slot's
    // role, and of its tier (as played as the card it replaces, within
    // REPAIR_TIER), before any other. Only the replacement is steered. Waste
    // Not for Mana Vault (a rock for a card that pays off nothing here) and
    // Leyline of Abundance for Dionus, Elvish Archdruid were the gate's.
    const q = (c: ScryfallCard) => ctx.qualityOf(c).q;
    const tierOk = (m: Move) =>
      m.in.every((c, j) => q(c) >= REPAIR_TIER * q(current.cards[m.out[j]]));
    const rank = (m: Move) => (sameRole.get(m) ? 2 : 0) + (tierOk(m) ? 1 : 0);
    if (!taken && bestRepair && rank(bestRepair.move) < 3) {
      const outs = bestRepair.move.out.join(',');
      let bestMatched: { move: Move; score: ObjectiveScore } | null = null;
      let tried = 0;
      for (const move of forcedRepair ? [...moves].sort(bestPlayed) : moves) {
        if (tried >= REPAIR_CHOICES) break;
        if (!sameRole.get(move) || move.out.join(',') !== outs) continue;
        if (evaluations.full >= opts.maxEvaluations || worked() > opts.timeBudgetMs) break;
        yield beat();
        const next = applyMove(current, move);
        if (repairable(checkConstraints(next, ctx)) >= curRepairable) continue;
        if (trust && !forcedRepair && judgeOf(move, false).bound) continue;
        if (trust && forcedRepair && (tierOf(move).tier > forcedTier || raisesBracket(move)))
          continue;
        tried++;
        const score = full(next);
        const beats =
          !bestMatched ||
          (tierOk(move) !== tierOk(bestMatched.move)
            ? tierOk(move)
            : compareScores(score, bestMatched.score) > 0);
        if (beats) bestMatched = { move, score };
      }
      if (bestMatched && rank(bestMatched.move) > rank(bestRepair.move)) bestRepair = bestMatched;
    }
    if (!taken && bestRepair) {
      const out = tierOf(bestRepair.move);
      taken = {
        move: bestRepair.move,
        score: bestRepair.score,
        kind: 'repair',
        disclosure: forcedRepair && out.why ? forcedDisclosure(out.tier, out.why) : undefined,
      };
    }
    if (!taken && escapesLeft > 0 && bestTried) {
      if (currentScore.total - bestTried.score.total <= opts.escapeTolerance) {
        taken = { move: bestTried.move, score: bestTried.score, kind: 'escape' };
        escapesLeft--;
      }
    }
    if (!taken) {
      // A step cut short by a budget found nothing yet; it is not an optimum.
      stoppedBy =
        evaluations.full >= opts.maxEvaluations
          ? 'max-evaluations'
          : worked() > opts.timeBudgetMs
            ? 'time'
            : 'local-optimum';
      break;
    }

    const outs = taken.move.out.map((i) => current.cards[i]);
    applied.push({
      out: outs,
      in: taken.move.in,
      kind: taken.kind,
      disclosure: taken.disclosure,
    });
    for (const c of taken.move.in) tabuOut.set(key(c.name), applied.length + opts.tabuTenure);
    for (const c of outs) tabuIn.set(key(c.name), applied.length + opts.tabuTenure);
    current = applyMove(current, taken.move);
    // The new deck is the new slot reference: every next neighbour differs
    // from it in one position.
    ctx = withSlots(current);
    currentScore = full(current);
    if (compareScores(currentScore, best.score) > 0) best = { deck: current, score: currentScore };
  }

  // The kept swaps: those that lead to the best deck (with no escapes, all).
  let kept = applied.slice(0, keptUpTo(applied, seed, best.deck));
  let deck = best.deck;

  // 4. Every swap read in the FINAL deck: its worth there (the final deck
  // against the same deck with that one swap undone) and its reasons, each
  // re-checked against the deck and the cards' text (reasonCheck.ts). Under
  // the trust region a swap is undone when, without the reasons that fail the
  // check, it no longer pays its margin there (a later swap made it redundant,
  // or it rested on a claim the cards don't bear out), until none does.
  const undone: OptimizeResult['undone'] = [];
  const undo = (d: ObjectiveDeck, s: (typeof kept)[number]): ObjectiveDeck => {
    const cards = [...d.cards];
    s.in.forEach((c, j) => {
      const i = cards.findIndex((x) => x.name === c.name);
      if (i >= 0) cards[i] = s.out[j];
    });
    return { commanders: d.commanders, cards };
  };
  const applyKept = (d: ObjectiveDeck, s: (typeof kept)[number]): ObjectiveDeck => {
    const cards = [...d.cards];
    s.out.forEach((o, j) => {
      const i = cards.findIndex((x) => x.name === o.name);
      if (i >= 0) cards[i] = s.in[j];
    });
    return { commanders: d.commanders, cards };
  };
  const readSwaps = () => {
    const c = withSlots(deck);
    const now = full(deck, c);
    // Each swap in the order it was made, from the seed.
    let stepFrom = seed;
    return kept.map((s) => {
      const stepTo = applyKept(stepFrom, s);
      const rolesNote = rolesMovedBetween(stepFrom, stepTo, roleOf, c.roleTargets);
      stepFrom = stepTo;
      const without = undo(deck, s);
      const then = full(without, c);
      const outNames = s.out.map((x) => x.name);
      const inNames = s.in.map((x) => x.name);
      const all = reasonsFor(then, now, outNames, inNames, rolesNote);
      // An incoming card's reason is about the final deck, an outgoing one's
      // about the deck it left.
      const problems = all.map((r) =>
        reasonProblem(r, inNames.includes(r.name) ? deck : without, c)
      );
      const partial = {
        out: outNames,
        in: inNames,
        kind: s.kind,
        delta: now.total - then.total,
        terms: termDeltas(now, then),
        reasons: all.filter((_, i) => problems[i] === null),
      };
      return {
        swap: {
          ...partial,
          summary: summaryOf(partial),
          ...(s.disclosure ? { disclosure: s.disclosure } : {}),
        } as AppliedSwap,
        source: s,
        without,
        breaks: infeasibility(then) > infeasibility(now),
        unverified: all
          .map((r, i) => ({ r, problem: problems[i] }))
          .filter((x): x is { r: SwapReason; problem: string } => x.problem !== null),
      };
    });
  };
  let read = readSwaps();
  for (let changed = !!trust; changed && kept.length > 0;) {
    changed = false;
    for (const x of read) {
      if (x.source.kind === 'repair' || x.breaks) continue;
      const claimed = x.unverified.reduce((s, u) => s + u.r.value, 0);
      if (x.swap.delta - claimed >= opts.minGain) continue;
      undone.push({
        out: x.swap.out,
        in: x.swap.in,
        delta: x.swap.delta,
        why: x.unverified.length
          ? `rests on ${x.unverified.map((u) => `${u.r.name}: ${u.problem}`).join('; ')}`
          : `gains ${x.swap.delta.toFixed(2)} in the final deck`,
      });
      kept = kept.filter((k) => k !== x.source);
      deck = x.without;
      read = readSwaps();
      changed = true;
      break;
    }
  }
  const swaps = read.map((x) => x.swap);
  const unverified = read.flatMap((x) =>
    x.unverified.map((u) => ({
      name: u.r.name,
      term: u.r.term,
      note: u.r.note,
      problem: u.problem,
    }))
  );

  // Report against the seed under ONE reference (the seed's slots).
  const report = { ...baseCtx, slotOrder: seed.cards.map((x) => x.name) };
  return {
    deck,
    score: scoreDeck(deck, report),
    seedScore: scoreDeck(seed, report),
    swaps,
    undone,
    unverified,
    refusals,
    evaluations,
    stoppedBy,
    ms: Date.now() - t0,
  };
}

/** How many applied swaps lead to the returned (best) deck: a prefix of all swaps. */
function keptUpTo(
  applied: Array<{ out: ScryfallCard[]; in: ScryfallCard[] }>,
  seed: ObjectiveDeck,
  bestDeck: ObjectiveDeck
): number {
  const target = bestDeck.cards
    .map((c) => c.name)
    .sort()
    .join('|');
  let names = seed.cards.map((c) => c.name);
  if (names.slice().sort().join('|') === target) return 0;
  for (let i = 0; i < applied.length; i++) {
    for (let j = 0; j < applied[i].out.length; j++) {
      const at = names.indexOf(applied[i].out[j].name);
      names = [...names.slice(0, at), applied[i].in[j].name, ...names.slice(at + 1)];
    }
    if (names.slice().sort().join('|') === target) return i + 1;
  }
  return applied.length;
}

export interface SwapJudgement {
  /** Full score change, the library in `deck`'s slots. */
  delta: number;
  /** The gain the move had to reach (its margin). */
  required: number;
  accepted: boolean;
  /** Why it was refused, when it was. */
  refusal: string | null;
  reasons: SwapReason[];
}

/**
 * One swap judged on its own against `deck`, by the rule the search applies:
 * a move is taken when it breaks no more hard constraints, stays inside the
 * trust region, and gains its margin. `trust: false` with `minGain: 0.1` is
 * the first gate's rule. The swap-label validation
 * (scripts/deck-objective-swaps.mjs) replays a gate's swaps through this.
 */
export function judgeSwap(
  deck: ObjectiveDeck,
  outNames: readonly string[],
  ins: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: Pick<OptimizeOptions, 'minGain' | 'trust'> = {}
): SwapJudgement {
  const minGain = options.minGain ?? MIN_GAIN;
  const trust = options.trust === false ? null : (options.trust ?? {});
  const ctx = { ...baseCtx, slotOrder: deck.cards.map((c) => c.name) };
  const idx: number[] = [];
  for (const n of outNames) {
    const i = deck.cards.findIndex((c, j) => c.name === n && !idx.includes(j));
    if (i < 0) throw new Error(`judgeSwap: ${n} is not in the deck`);
    idx.push(i);
  }
  const next = applyMove(deck, { out: idx, in: [...ins] });
  const before = scoreDeck(deck, ctx);
  const after = scoreDeck(next, ctx);
  const delta = after.total - before.total;
  const reasons = reasonsFor(
    before,
    after,
    [...outNames],
    ins.map((c) => c.name)
  );
  const worse = infeasibility(after) > infeasibility(before);
  if (worse) {
    const refusal = `breaks ${after.violations.map((v) => v.check).join(', ')}`;
    return { delta, required: minGain, accepted: false, refusal, reasons };
  }
  let required = minGain;
  if (trust) {
    const roleOf = memoRoleOf(trust.roleOf ?? ctx.roleOf ?? factsRoleOf(ctx));
    const verdict = trustVerdict(
      countRoles(deck, roleOf),
      idx.map((i) => deck.cards[i]),
      ins,
      ctx,
      protectedCards(deck, ctx, trust.stapleBar),
      minGain,
      {
        ...trust,
        roleOf,
        classesNow: classCounts(deck, ctx),
        gameChangersNow: gameChangerCount(deck, ctx),
        repair: infeasibility(after) < infeasibility(before),
      }
    );
    if (verdict.blocked) {
      return {
        delta,
        required: verdict.required,
        accepted: false,
        refusal: verdict.blocked,
        reasons,
      };
    }
    required = verdict.required;
    // As the search's final read: a claim the cards don't bear out doesn't count.
    const bad = reasons.filter(
      (r) => reasonProblem(r, ins.some((c) => c.name === r.name) ? next : deck, ctx) !== null
    );
    const claimed = bad.reduce((s, r) => s + r.value, 0);
    if (bad.length && delta - claimed < required) {
      const refusal = `rests on ${bad.map((r) => `${r.name} (${r.term})`).join(', ')}`;
      return { delta, required, accepted: false, refusal, reasons };
    }
  }
  const refusal = delta < required ? `gains ${delta.toFixed(2)} < ${required.toFixed(2)}` : null;
  return { delta, required, accepted: refusal === null, refusal, reasons };
}
