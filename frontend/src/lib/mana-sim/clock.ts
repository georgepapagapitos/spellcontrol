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
 *   games, so it runs after paint in slices of a few milliseconds, yielding to
 *   the browser between them (a phone is about 4x slower than the numbers in
 *   the comments here). Each game draws its own random stream from (seed, game
 *   index), so the sliced run is the same run: identical numbers to the
 *   synchronous call. Results are cached by deck, win path and options, and a
 *   second screen asking for the same clock shares the first one's run.
 */

import { buildManaDeck } from './index';
import { simulateGoal, simulateGoalTurns } from './engine';
import {
  librarySeed,
  simulateColorlessClock,
  type AssemblyClockOptions,
  type AssemblyClockResult,
  type ClockCard,
} from './opening-hand-sim';
import { summarizeTurns } from './turn-distribution';
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
    { options, tutors: opts.wildcards },
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

/** Milliseconds of engine work per slice: under one frame at 60 Hz with room to spare. */
const SLICE_MS = 6;
/** Games in the timing slice, which sets the size of the rest. */
const PROBE_GAMES = 4;
const MAX_SLICE_GAMES = 200;
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
    const goal = { options, tutors: opts.wildcards };
    const games = Math.max(1, Math.floor(opts.iterations ?? 1000));
    const seed = opts.seed ?? librarySeed(library);
    const turns: number[] = [];
    let size = Math.min(PROBE_GAMES, games);
    let perGame = 0;
    while (turns.length < games) {
      const t0 = performance.now();
      const slice = simulateGoalTurns(deck, goal, {
        games: Math.min(size, games - turns.length),
        firstGame: turns.length,
        seed,
      });
      if (!slice) return null;
      turns.push(...slice);
      // Games vary a lot (one that never finishes plays out the whole library),
      // so the size follows the slowest per-game cost seen, not the average.
      perGame = Math.max(perGame * 0.8, (performance.now() - t0) / slice.length, 0.001);
      size = Math.max(1, Math.min(MAX_SLICE_GAMES, Math.floor(SLICE_MS / perGame)));
      if (turns.length < games) await yieldToBrowser();
    }
    return summarizeTurns(turns);
  })()
    .then((clock) => {
      remember(key, clock);
      return clock;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
