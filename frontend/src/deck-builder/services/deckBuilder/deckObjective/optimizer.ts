/**
 * The whole-deck search (E513, slice 2): start from a finished deck (the
 * generator's) and improve it one swap at a time, every swap judged against
 * the WHOLE deck by the objective, hard constraints enforced on every move.
 * Generation-inert: nothing in the generator calls it yet.
 *
 *   optimizeDeck(seed, candidates, ctx, opts) → { deck, score, swaps, ... }
 *
 * Moves: 1:1 swaps within a slot class (a spell for a spell, a nonbasic land
 * for a nonbasic land, a basic for a basic, so the land count and the
 * nonbasic count the plan chose stay put: on a first run, with lands one
 * class, the search traded fourteen of Meren's Swamps for utility lands), and
 * 2:2 swaps that seat both missing pieces of a two-piece combo from the
 * context's combo set.
 * Protected: the commander (never in the 99), must-includes, and `locks`.
 *
 * Search: first-improvement hill climbing, cheapest-to-judge first.
 *  1. Every removable card's loss and every candidate's gain are read with the
 *     FAST terms (all but the two simulated ones, mana and winline): the
 *     score of the deck without the card, and with the candidate added.
 *  2. Pairs are ranked by gain − loss, and the best SHORTLIST are checked
 *     exactly with the fast terms, in order; a pair that clears FAST_GATE is
 *     scored in full (both simulations, the library laid out in the current
 *     deck's slots, so the two decks play the same shuffled positions), and
 *     the first whose full gain clears `minGain` is applied.
 *  3. When nothing clears it (a local optimum), up to `escapes` times the best
 *     fully scored move that costs less than `escapeTolerance` is applied
 *     anyway, and the search goes on. A tabu list stops the next TABU_TENURE
 *     swaps from undoing a move. The best deck ever seen is returned.
 *
 * Deterministic: every ordering breaks ties by name, the goldfish seeds are
 * the context's, and the budgets count evaluations, not milliseconds. The
 * wall-clock cap is a safety net; hitting it is reported (`stoppedBy: 'time'`)
 * because it makes the result depend on the machine.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/card-text';
import { normalizeCardName } from '../cardIdentity';
import { cardIneligibility, checkConstraints } from './constraints';
import { isBasicLand, isLandCard } from './context';
import { TERMS, compareScores, infeasibility, scoreDeck, termDeltas } from './index';
import {
  TERM_KEYS,
  type ObjectiveContext,
  type ObjectiveDeck,
  type ObjectiveScore,
  type TermKey,
} from './types';

/** The two terms that simulate games; everything else is cheap. */
export const SLOW_TERMS: readonly TermKey[] = ['mana', 'winline'];
export const FAST_TERMS: readonly TermKey[] = TERM_KEYS.filter((k) => !SLOW_TERMS.includes(k));

export interface OptimizeOptions {
  /** Card names that must stay (in addition to the customization's must-includes). */
  locks?: readonly string[];
  /** Stop after this many applied swaps. Default 25. */
  maxSwaps?: number;
  /** Stop after this many FULL scores (the expensive evaluations). Default 300. */
  maxEvaluations?: number;
  /** A move must gain at least this much, in card-equivalents. Default 0.1: above the mana term's per-swap noise with common random numbers. */
  minGain?: number;
  /** Fast-judged pairs per step. Default 40. */
  shortlist?: number;
  /** Local-optimum escapes. Default 2. */
  escapes?: number;
  /** An escape may cost at most this much. Default 0.3. */
  escapeTolerance?: number;
  /** Swaps a move stays tabu for. Default 6. */
  tabuTenure?: number;
  /** Seat both missing pieces of a two-piece combo in one move. Default true. */
  comboPairs?: boolean;
  /** Safety cap in milliseconds. Default 10 minutes. */
  timeBudgetMs?: number;
}

export interface SwapReason {
  name: string;
  term: TermKey;
  value: number;
  note: string;
}

export interface AppliedSwap {
  out: string[];
  in: string[];
  kind: 'improve' | 'combo' | 'escape';
  /** Total change in the score (full, with the simulations). */
  delta: number;
  /** Each term's contribution change. */
  terms: Record<TermKey, number>;
  /** The per-card notes behind the change: what the cards in did, what the cards out had done. */
  reasons: SwapReason[];
  /** One line. */
  summary: string;
}

export interface OptimizeResult {
  deck: ObjectiveDeck;
  score: ObjectiveScore;
  seedScore: ObjectiveScore;
  swaps: AppliedSwap[];
  evaluations: { fast: number; full: number };
  stoppedBy: 'local-optimum' | 'max-swaps' | 'max-evaluations' | 'time' | 'no-candidates';
  ms: number;
}

const DEFAULTS = {
  maxSwaps: 25,
  maxEvaluations: 300,
  minGain: 0.1,
  shortlist: 40,
  escapes: 2,
  escapeTolerance: 0.3,
  tabuTenure: 6,
  comboPairs: true,
  timeBudgetMs: 600_000,
};
/** A pair is scored in full once its fast gain reaches this share of `minGain`. */
const FAST_GATE = 0.5;

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

function reasonsFor(
  before: ObjectiveScore,
  after: ObjectiveScore,
  outs: string[],
  ins: string[]
): SwapReason[] {
  const out: SwapReason[] = [];
  for (const term of TERM_KEYS) {
    for (const n of after.terms[term].detail.cards)
      if (ins.includes(n.name))
        out.push({ name: n.name, term, value: n.value * after.terms[term].weight, note: n.note });
    for (const n of before.terms[term].detail.cards)
      if (outs.includes(n.name))
        out.push({ name: n.name, term, value: -n.value * before.terms[term].weight, note: n.note });
  }
  return out
    .filter((r) => Math.abs(r.value) >= 0.005)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name));
}

function summaryOf(swap: Omit<AppliedSwap, 'summary'>): string {
  const top = TERM_KEYS.filter((k) => Math.abs(swap.terms[k]) >= 0.01)
    .sort((a, b) => Math.abs(swap.terms[b]) - Math.abs(swap.terms[a]))
    .slice(0, 3)
    .map((k) => `${k} ${swap.terms[k] >= 0 ? '+' : ''}${swap.terms[k].toFixed(2)}`);
  return `${swap.in.join(' + ')} for ${swap.out.join(' + ')}: ${swap.delta >= 0 ? '+' : ''}${swap.delta.toFixed(2)} (${top.join(', ')})`;
}

export function optimizeDeck(
  seed: ObjectiveDeck,
  candidates: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: OptimizeOptions = {}
): OptimizeResult {
  const opts = { ...DEFAULTS, ...options };
  const t0 = Date.now();
  const cz = baseCtx.customization;
  const protectedKeys = new Set(
    [...(cz.mustIncludeCards ?? []), ...(cz.tempMustIncludeCards ?? []), ...(opts.locks ?? [])].map(
      key
    )
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
  const full = (deck: ObjectiveDeck) => {
    evaluations.full++;
    return scoreDeck(deck, ctx);
  };
  const fast = (deck: ObjectiveDeck) => {
    evaluations.fast++;
    return partialTotal(deck, ctx, FAST_TERMS);
  };

  const seedScore = full(current);
  let currentScore = seedScore;
  let best = { deck: current, score: currentScore };
  const swaps: AppliedSwap[] = [];
  const tabuOut = new Map<string, number>(); // key -> swap index until which it can't leave
  const tabuIn = new Map<string, number>(); // key -> swap index until which it can't return
  let escapesLeft = opts.escapes;
  let stoppedBy: OptimizeResult['stoppedBy'] = 'local-optimum';
  if (pool.length === 0) stoppedBy = 'no-candidates';

  while (pool.length > 0) {
    if (swaps.length >= opts.maxSwaps) {
      stoppedBy = 'max-swaps';
      break;
    }
    if (evaluations.full >= opts.maxEvaluations) {
      stoppedBy = 'max-evaluations';
      break;
    }
    if (Date.now() - t0 > opts.timeBudgetMs) {
      stoppedBy = 'time';
      break;
    }
    const step = swaps.length;
    const inDeck = new Set(current.cards.map((c) => key(c.name)));
    const fastNow = fast(current);

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
      }
      lossOf.set(i, loss);
    }
    const addable = pool.filter(
      (c) => (isBasicLand(c) || !inDeck.has(key(c.name))) && (tabuIn.get(key(c.name)) ?? -1) < step
    );
    const gainOf = new Map<ScryfallCard, number>();
    for (const c of addable) {
      gainOf.set(
        c,
        fast({ commanders: current.commanders, cards: [...current.cards, c] }) - fastNow
      );
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
      const outs = outsByClass('spell');
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
    moves.sort(
      (a, b) =>
        b.estimate - a.estimate ||
        a.in
          .map((c) => c.name)
          .join('|')
          .localeCompare(b.in.map((c) => c.name).join('|')) ||
        a.out[0] - b.out[0]
    );

    // 3. Judge the best candidates exactly, cheapest first.
    let applied: { move: Move; score: ObjectiveScore; kind: AppliedSwap['kind'] } | null = null;
    let bestTried: { move: Move; score: ObjectiveScore } | null = null;
    const curInfeasible = infeasibility(currentScore);
    for (const move of moves.slice(0, opts.shortlist)) {
      if (evaluations.full >= opts.maxEvaluations || Date.now() - t0 > opts.timeBudgetMs) break;
      const next = applyMove(current, move);
      const violations = checkConstraints(next, ctx);
      const nextInfeasible = violations.reduce((s, v) => s + v.magnitude, 0);
      if (nextInfeasible > curInfeasible) continue;
      const fastGain = fast(next) - fastNow;
      const repairs = nextInfeasible < curInfeasible;
      if (!repairs && fastGain < FAST_GATE * opts.minGain) {
        continue;
      }
      const score = full(next);
      if (!bestTried || compareScores(score, bestTried.score) > 0) bestTried = { move, score };
      if (repairs || score.total - currentScore.total >= opts.minGain) {
        applied = { move, score, kind: move.kind };
        break;
      }
    }
    if (!applied && escapesLeft > 0 && bestTried) {
      if (currentScore.total - bestTried.score.total <= opts.escapeTolerance) {
        applied = { move: bestTried.move, score: bestTried.score, kind: 'escape' };
        escapesLeft--;
      }
    }
    if (!applied) {
      stoppedBy = 'local-optimum';
      break;
    }

    const outNames = applied.move.out.map((i) => current.cards[i].name);
    const inNames = applied.move.in.map((c) => c.name);
    const partial = {
      out: outNames,
      in: inNames,
      kind: applied.kind,
      delta: applied.score.total - currentScore.total,
      terms: termDeltas(applied.score, currentScore),
      reasons: reasonsFor(currentScore, applied.score, outNames, inNames),
    };
    swaps.push({ ...partial, summary: summaryOf(partial) });
    for (const n of inNames) tabuOut.set(key(n), swaps.length + opts.tabuTenure);
    for (const n of outNames) tabuIn.set(key(n), swaps.length + opts.tabuTenure);
    current = applyMove(current, applied.move);
    // The new deck is the new slot reference: every next neighbour differs
    // from it in one position.
    ctx = withSlots(current);
    currentScore = full(current);
    if (compareScores(currentScore, best.score) > 0) best = { deck: current, score: currentScore };
  }

  // Report against the seed under ONE reference (the seed's slots).
  const report = { ...baseCtx, slotOrder: seed.cards.map((c) => c.name) };
  const finalSeed = scoreDeck(seed, report);
  const finalBest = scoreDeck(best.deck, report);
  return {
    deck: best.deck,
    score: finalBest,
    seedScore: finalSeed,
    swaps: swaps.slice(0, swapsUpTo(swaps, seed, best.deck)),
    evaluations,
    stoppedBy,
    ms: Date.now() - t0,
  };
}

/** The applied swaps that lead to the returned (best) deck: a prefix of all swaps. */
function swapsUpTo(swaps: AppliedSwap[], seed: ObjectiveDeck, bestDeck: ObjectiveDeck): number {
  const target = bestDeck.cards
    .map((c) => c.name)
    .sort()
    .join('|');
  let names = seed.cards.map((c) => c.name);
  if (names.slice().sort().join('|') === target) return 0;
  for (let i = 0; i < swaps.length; i++) {
    for (let j = 0; j < swaps[i].out.length; j++) {
      const at = names.indexOf(swaps[i].out[j]);
      names = [...names.slice(0, at), swaps[i].in[j], ...names.slice(at + 1)];
    }
    if (names.slice().sort().join('|') === target) return i + 1;
  }
  return swaps.length;
}
