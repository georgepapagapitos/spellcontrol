/**
 * The assembly clock: "typically online by turn N", asked of the goldfish.
 *
 * When every library card carries its `ManaCard` (`toClockLibrary`), the clock
 * runs on the manabase engine (`simulateGoal`): colors are enforced, lands
 * enter tapped or untapped by their text, ramp makes what it makes, and draw
 * spells draw what they say. A library without them (the deck-generation
 * objective's win-line term, which scores thousands of candidate decks and is
 * gated separately) runs the colorless clock in `opening-hand-sim.ts`.
 *
 * Two ways to ask:
 *
 * - `simulateAssemblyClock`: synchronous, for scripts and tests.
 * - `assemblyClockAsync` (and the `useAssemblyClock` hook over it): what every
 *   screen uses. The engine costs tens to hundreds of milliseconds per 1,000
 *   games, so it runs after paint in slices of a few milliseconds (cut between turns, even inside a game), yielding to
 *   the browser between them (a phone is about 4x slower than the numbers in
 *   the comments here). Each game draws its own random stream from (seed, game
 *   index), so the sliced run is the same run: identical numbers to the
 *   synchronous call. Results are cached by deck, win path and options, and a
 *   second screen asking for the same clock shares the first one's run.
 */

import { buildManaDeck } from './index';
import { simulateGoal, simulateGoalSteps } from './engine';
import {
  librarySeed,
  simulateColorlessClock,
  type AssemblyClockOptions,
  type AssemblyClockResult,
  type ClockCard,
} from './opening-hand-sim';
import { CLOCK_HORIZON, summarizeTurns } from './turn-distribution';
import type { ManaCard } from './types';

type ClockOptions = ReadonlyArray<{ names: readonly string[]; need: number }>;

export function simulateAssemblyClock(
  library: readonly ClockCard[],
  options: ClockOptions,
  opts: AssemblyClockOptions = {}
): AssemblyClockResult | null {
  const mana = manaOf(library);
  if (!mana) return simulateColorlessClock(library, options, opts);
  return simulateGoal(
    buildManaDeck([], mana),
    { options, tutors: opts.wildcards, horizon: opts.horizon ?? CLOCK_HORIZON },
    { games: opts.iterations, seed: opts.seed }
  );
}

function manaOf(library: readonly ClockCard[]): ManaCard[] | null {
  const mana: ManaCard[] = [];
  for (const c of library) {
    if (!c.mana) return null;
    mana.push(c.mana);
  }
  return mana;
}

// ── After paint, in slices, shared ──────────────────────────────────────────

/** Milliseconds of engine work per slice, checked between turns: under one frame at 60 Hz with room to spare. */
const SLICE_MS = 6;
const CACHE_SIZE = 32;

const cache = new Map<string, AssemblyClockResult | null>();
const inflight = new Map<string, Promise<AssemblyClockResult | null>>();

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The identity of one clock: the deck's cards, the win path, and every option that moves the numbers. */
export function clockKey(
  library: readonly ClockCard[],
  options: ClockOptions,
  opts: AssemblyClockOptions = {}
): string {
  const names = library
    .map((c) => c.name)
    .sort()
    .join('|');
  const path = options.map((o) => `${o.need}:${[...o.names].sort().join(',')}`).join(';');
  const tutors = [...(opts.wildcards ?? [])].sort().join(',');
  const colored = library.every((c) => c.mana) ? 'c' : 'x';
  return [
    names,
    path,
    tutors,
    opts.horizon ?? CLOCK_HORIZON,
    opts.iterations ?? 1000,
    opts.seed ?? librarySeed(library),
    colored,
  ].join('#');
}

/** The finished clock for this key, or undefined when it has not been run. */
export function peekAssemblyClock(key: string): AssemblyClockResult | null | undefined {
  return cache.get(key);
}

function remember(key: string, clock: AssemblyClockResult | null): void {
  cache.set(key, clock);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

/**
 * The same numbers as `simulateAssemblyClock`, computed after paint in slices.
 * Concurrent calls for one clock share a single run.
 */
export function assemblyClockAsync(
  library: readonly ClockCard[],
  options: ClockOptions,
  opts: AssemblyClockOptions = {}
): Promise<AssemblyClockResult | null> {
  const key = clockKey(library, options, opts);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    await yieldToBrowser();
    const mana = manaOf(library);
    if (!mana) return simulateColorlessClock(library, options, opts);
    const deck = buildManaDeck([], mana);
    const horizon = opts.horizon ?? CLOCK_HORIZON;
    const goal = { options, tutors: opts.wildcards, horizon };
    const games = Math.max(1, Math.floor(opts.iterations ?? 1000));
    const seed = opts.seed ?? librarySeed(library);
    // One run, handed back to the browser between turns once a slice's time is
    // used (a game that never assembles plays out every turn to the horizon, so
    // slicing by whole games left a tail). Same games, same numbers.
    const budget = { until: 0 };
    const steps = simulateGoalSteps(deck, goal, { games, seed, budget });
    let step: IteratorResult<void, number[] | null>;
    do {
      budget.until = performance.now() + SLICE_MS;
      step = steps.next();
      if (!step.done) await yieldToBrowser();
    } while (!step.done);
    const turns = step.value;
    if (!turns) return null;
    return summarizeTurns(turns, horizon);
  })()
    .then((clock) => {
      remember(key, clock);
      return clock;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
