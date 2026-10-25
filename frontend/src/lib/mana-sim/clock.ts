/**
 * The assembly clock: "typically online by turn N", asked of the goldfish.
 *
 * When every library card carries its `ManaCard` (`toClockLibrary`), the clock
 * runs on the manabase engine (`simulateGoal`): colors are enforced, lands
 * enter tapped or untapped by their text, ramp makes what it makes, and draw
 * spells draw what they say. A library without them (the deck-generation
 * objective's win-line term, which scores thousands of candidate decks and is
 * gated separately) runs the colorless clock in `opening-hand-sim.ts`.
 */

import { buildManaDeck } from './index';
import { simulateGoal } from './engine';
import {
  simulateColorlessClock,
  type AssemblyClockOptions,
  type AssemblyClockResult,
  type ClockCard,
} from './opening-hand-sim';
import type { ManaCard } from './types';

export function simulateAssemblyClock(
  library: readonly ClockCard[],
  options: ReadonlyArray<{ names: readonly string[]; need: number }>,
  opts: AssemblyClockOptions = {}
): AssemblyClockResult | null {
  const mana: ManaCard[] = [];
  for (const c of library) {
    if (!c.mana) return simulateColorlessClock(library, options, opts);
    mana.push(c.mana);
  }
  return simulateGoal(
    buildManaDeck([], mana),
    { options, tutors: opts.wildcards },
    { games: opts.iterations, seed: opts.seed }
  );
}
