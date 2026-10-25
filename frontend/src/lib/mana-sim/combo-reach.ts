/**
 * Combo reachability: for a Spellbook combo in the deck, how often is it
 * assembled (every library piece drawn AND cast, in color) by turn 6, 8 and 10?
 *
 * It is the assembly clock (`./clock.ts`) asked of one combo's pieces instead
 * of the deck's primary win path, so it plays the same goldfish: draw,
 * mulligans, ramp, colors, and the deck's non-land tutors as extra outs (a
 * cast tutor fetches the cheapest missing piece into hand, where it still has
 * to be cast). The commander and partner start in the command zone and are
 * never part of the set to draw; a combo made only of them has nothing to time
 * (the bug `speedPathOf` fixed in #3034), and one that needs a card the combo
 * only describes, or a card in the sideboard, is not timed at all.
 */

import type { ComboSummary } from '@/types/combos';
import type { AssemblyClockResult } from './opening-hand-sim';
import { wilsonInterval } from './turn-distribution';

/** The turns a combo's reach is read at. */
export const REACH_TURNS = [6, 8, 10] as const;
/** Games stop here: every figure shown is at or before it, so the rest is not played. */
export const REACH_HORIZON = 10;
/** Games per combo. A share near half is good to about three points. */
export const REACH_GAMES = 1000;

export interface ReachOption {
  names: string[];
  need: number;
}

export type ReachPlan =
  /** Time these pieces. */
  | { kind: 'timed'; option: ReachOption }
  /** Say why there is no timing. */
  | { kind: 'untimed'; reason: 'templates' | 'sideboard' }
  /** Nothing to draw (every piece is in the command zone): show nothing. */
  | { kind: 'none' };

const frontFace = (name: string): string => name.split(' // ')[0];

/**
 * What to time for one combo. `commandZone` holds the commander and partner
 * names; `libraryNames` the names of the cards that are drawn (the mainboard).
 * A combo that names a double-faced card by its front face matches the
 * library's full name.
 */
export function planComboReach(
  combo: Pick<ComboSummary, 'cards' | 'templates'>,
  commandZone: ReadonlySet<string>,
  libraryNames: Iterable<string>
): ReachPlan {
  if (combo.templates && combo.templates.length > 0)
    return { kind: 'untimed', reason: 'templates' };
  const library = new Map<string, string>();
  for (const n of libraryNames) {
    library.set(n, n);
    if (!library.has(frontFace(n))) library.set(frontFace(n), n);
  }
  const inCommandZone = (n: string): boolean =>
    commandZone.has(n) || [...commandZone].some((c) => frontFace(c) === frontFace(n));
  const names: string[] = [];
  for (const { cardName } of combo.cards) {
    if (inCommandZone(cardName)) continue;
    const found = library.get(cardName) ?? library.get(frontFace(cardName));
    if (!found) return { kind: 'untimed', reason: 'sideboard' };
    if (!names.includes(found)) names.push(found);
  }
  return names.length > 0
    ? { kind: 'timed', option: { names, need: names.length } }
    : { kind: 'none' };
}

export interface ReachTurn {
  turn: number;
  /** Share of games assembled by this turn. */
  p: number;
  lo: number;
  hi: number;
}

/** The shares at {@link REACH_TURNS} out of a clock run (`assembledBy` is exact up to the horizon). */
export function reachTurns(clock: Pick<AssemblyClockResult, 'runs' | 'assembledBy'>): ReachTurn[] {
  return REACH_TURNS.map((turn) => {
    const p = clock.assembledBy[turn] ?? 0;
    return { turn, p, ...wilsonInterval(Math.round(p * clock.runs), clock.runs) };
  });
}
