/**
 * Mulligan advisor: keep this seven, or mulligan? Answered by playing it out.
 *
 * The hand on screen is dealt into the goldfish (`ManaSimOptions.opening`) and
 * played on for many seeded games; a fresh seven (the free first mulligan of a
 * multiplayer Commander game) and a London mulligan to six are played the same
 * way. Each comes back as the same four odds, each with its run count and
 * Wilson interval, and one rule turns them into a verdict (`adviseMulligan`).
 *
 * It is a goldfish estimate: no opponent, no interaction, no card selection
 * beyond what the engine reads from text. And it compares the hand with a
 * fresh seven KEPT AS DEALT, where a real player would look at that seven too
 * and could mulligan again; that understates a mulligan, so the advice leans
 * toward keeping.
 *
 * The recommendation rule, in full:
 *
 * 1. The metric that decides is the chance the deck's win path is assembled by
 *    turn {@link CLOCK_EARLY_TURN} when the deck has one and either side of
 *    the comparison reaches {@link PATH_INFORMATIVE} (below that, "never in
 *    2,000 games" says nothing about the hand). Otherwise it is the chance of
 *    {@link DEVELOPED_SPELLS} spells cast by turn {@link DEVELOPED_TURN}, which
 *    fails a hand that is short of lands and a hand that is drowning in them.
 * 2. Mulligan when a fresh seven beats this hand on that metric by at least
 *    {@link MULLIGAN_MARGIN} AND their 95% intervals do not overlap. Otherwise
 *    keep, and call it close when the gap is under the margin.
 */

import { simulateGamesSteps } from './engine';
import { buildManaDeck } from './index';
import { CLOCK_EARLY_TURN, librarySeed } from './opening-hand-sim';
import { wilsonInterval } from './turn-distribution';
import type { GameTrace, ManaCard } from './types';

/** Games per scenario: a rate's interval is about two points wide each way at 50%. */
export const ADVISOR_RUNS = 2000;
/** Turns played. Covers every figure below. */
export const ADVISOR_TURNS = CLOCK_EARLY_TURN;
/** The gap a mulligan must open on the deciding metric. */
export const MULLIGAN_MARGIN = 0.06;
/** The least win-path chance (by either side) that makes the path the deciding metric. */
export const PATH_INFORMATIVE = 0.1;
/** "Developed": this many spells cast (the commander and ramp count) ... */
export const DEVELOPED_SPELLS = 4;
/** ... by the end of this turn. */
export const DEVELOPED_TURN = 5;

/** An average with its 95% range (1.96 standard errors). */
export interface Mean {
  mean: number;
  lo: number;
  hi: number;
}

export interface Rate {
  p: number;
  lo: number;
  hi: number;
}

/** What playing on from one opening looks like. */
export interface OpeningOdds {
  runs: number;
  /** P(at least one spell cast by the end of turn 3). */
  castBy3: Rate;
  /** P(all four land drops made by the end of turn 4). */
  landsBy4: Rate;
  /** P({@link DEVELOPED_SPELLS} or more spells cast by the end of turn {@link DEVELOPED_TURN}). */
  developed: Rate;
  /** Spells cast by the end of turn {@link ADVISOR_TURNS} on average: what a card fewer costs. */
  spellsBy6: Mean;
  /** P(win path assembled by turn {@link CLOCK_EARLY_TURN}); null when the deck has no timed path. */
  path: Rate | null;
}

export type DecidingMetric = 'path' | 'developed';

export interface MulliganAdvice {
  hand: OpeningOdds;
  /** A fresh seven kept as dealt: the free first mulligan. */
  mull7: OpeningOdds;
  /** A London mulligan to six: one card bottomed. */
  mull6: OpeningOdds;
  metric: DecidingMetric;
  /** Fresh seven minus this hand on the deciding metric (negative: the hand is better). */
  edge: number;
  verdict: 'keep' | 'mulligan';
  /** A keep that is no clear win: the fresh seven is within {@link MULLIGAN_MARGIN} of this hand, or ahead of it inside the noise. */
  close: boolean;
}

const rate = (n: number, of: number): Rate => {
  const p = n / of;
  const { lo, hi } = wilsonInterval(n, of);
  // Wilson's centre sits off p at the ends; the point estimate stays inside its interval.
  return { p, lo: Math.min(lo, p), hi: Math.max(hi, p) };
};

function meanOf(xs: readonly number[]): Mean {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const half = 1.96 * Math.sqrt(variance / n);
  return { mean, lo: mean - half, hi: mean + half };
}

/** Fold the games of one scenario into its odds. */
export function oddsOf(
  games: readonly GameTrace[],
  pathOnline: readonly number[] | null
): OpeningOdds {
  const n = games.length;
  const count = (test: (g: GameTrace) => boolean): number => games.filter(test).length;
  return {
    runs: n,
    castBy3: rate(
      count((g) => g.casts[3] >= 1),
      n
    ),
    landsBy4: rate(
      count((g) => g.drops[4] >= 4),
      n
    ),
    developed: rate(
      count((g) => g.casts[DEVELOPED_TURN] >= DEVELOPED_SPELLS),
      n
    ),
    spellsBy6: meanOf(games.map((g) => g.casts[ADVISOR_TURNS])),
    path: pathOnline
      ? rate(pathOnline.filter((t) => t <= CLOCK_EARLY_TURN).length, pathOnline.length)
      : null,
  };
}

/** The rule from the file header. Pure: the same three odds always give the same advice. */
export function adviseMulligan(
  hand: OpeningOdds,
  mull7: OpeningOdds,
  mull6: OpeningOdds
): MulliganAdvice {
  const useful =
    hand.path !== null &&
    mull7.path !== null &&
    Math.max(hand.path.p, mull7.path.p) >= PATH_INFORMATIVE;
  const metric: DecidingMetric = useful ? 'path' : 'developed';
  const a = (useful ? hand.path : hand.developed) as Rate;
  const b = (useful ? mull7.path : mull7.developed) as Rate;
  const edge = b.p - a.p;
  const mulligan = edge >= MULLIGAN_MARGIN && b.lo > a.hi;
  return {
    hand,
    mull7,
    mull6,
    metric,
    edge,
    verdict: mulligan ? 'mulligan' : 'keep',
    close: !mulligan && edge > -MULLIGAN_MARGIN,
  };
}

export interface AdvisorInput {
  commanders: readonly ManaCard[];
  library: readonly ManaCard[];
  /** The seven dealt, by name. */
  hand: readonly string[];
  /** The deck's timed win path (`speedPathOf`), or null. */
  path: {
    assembly: ReadonlyArray<{ names: readonly string[]; need: number }>;
    tutors: readonly string[];
  } | null;
  runs?: number;
  /** Seed for the scenarios. Default: derived from the card names. */
  seed?: number;
}

export interface SliceBudget {
  until: number;
}

type Scenario = { hand?: readonly string[]; bottom: number };

/**
 * One scenario as a generator that hands control back between turns once
 * `budget.until` has passed. The same games run at once or sliced.
 */
export function* scenarioSteps(
  input: AdvisorInput,
  scenario: Scenario,
  seed: number,
  budget?: SliceBudget
): Generator<void, OpeningOdds> {
  const deck = buildManaDeck(input.commanders, input.library);
  const games = Math.max(1, Math.floor(input.runs ?? ADVISOR_RUNS));
  const opening = { hand: scenario.hand, bottom: scenario.bottom };
  const traces: GameTrace[] = [];
  // Two runs over the same shuffles: the plain one casts everything it can
  // (the spell counts); the goal one plays to the win path (when it comes).
  yield* simulateGamesSteps(deck, null, {
    games,
    seed,
    maxTurn: ADVISOR_TURNS,
    opening,
    budget,
    onGame: (g) => traces.push(g),
  });
  let online: number[] | null = null;
  if (input.path) {
    online = [];
    yield* simulateGamesSteps(
      deck,
      { options: input.path.assembly, tutors: input.path.tutors, horizon: ADVISOR_TURNS },
      { games, seed, opening, budget, onGame: (g) => online?.push(g.online) }
    );
  }
  return oddsOf(traces, online);
}

/** The seed every scenario of a deck shares; the hand's own is this mixed with the hand. */
export function advisorSeed(library: readonly { name: string }[]): number {
  return librarySeed(library);
}

export function handSeed(base: number, hand: readonly string[]): number {
  return (base ^ librarySeed(hand.map((name) => ({ name })))) >>> 0;
}

/** All three scenarios, run at once. For tests and scripts; screens use the async one. */
export function simulateMulliganAdvice(input: AdvisorInput): MulliganAdvice {
  const seed = input.seed ?? advisorSeed(input.library);
  const run = (s: Scenario, sd: number): OpeningOdds => {
    const it = scenarioSteps(input, s, sd);
    for (;;) {
      const step = it.next();
      if (step.done) return step.value;
    }
  };
  return adviseMulligan(
    run({ hand: input.hand, bottom: 0 }, handSeed(seed, input.hand)),
    run({ bottom: 0 }, seed),
    run({ bottom: 1 }, seed)
  );
}
