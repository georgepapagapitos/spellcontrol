/**
 * Speed: how a deck's simulated clock compares with the turn expectations in
 * Wizards' Commander Brackets update of October 21, 2025.
 *
 * The package has no simulator. The caller runs one (the app's assembly clock)
 * and hands in its distribution as a {@link ClockSignal}; this file only reads
 * it. The signal is an estimate from a goldfish model: it sees the deck's own
 * win path and no opposing play, so it feeds the soft score (never a floor) and
 * is always shown with its sample size.
 */

/**
 * The earliest turn each bracket expects a game to end on, from Wizards'
 * October 21, 2025 update: Exhibition at least 9 turns, Core at least 8,
 * Upgraded at least 6, Optimized at least 4, cEDH any turn. Bracket 5 sets no
 * minimum, stored as 1.
 */
export const TURN_EXPECTATIONS: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 9,
  2: 8,
  3: 6,
  4: 4,
  5: 1,
};

/** What the clock simulated: the share of games whose win path was assembled by each turn. */
export interface ClockSignal {
  /** Games simulated. */
  runs: number;
  /** Share of games (0-1) assembled by turn t, indexed by turn; index 0 is 0. */
  assembledBy: readonly number[];
}

/** The turn the soft score reads: Upgraded (Bracket 3) expects turn 6 or later, so this is "before turn 6". */
export const SPEED_TURN = 5;

/** Fewer games than this and a share is too loose to move a score. */
export const SPEED_MIN_RUNS = 200;

const Z95 = 1.959964;

/** 95% Wilson score interval for `successes` of `n`. */
function wilson(successes: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Share of games assembled by `turn`, clamped into [0, 1]; 0 for a turn the signal does not reach. */
export function shareByTurn(clock: ClockSignal, turn: number): number {
  const p = clock.assembledBy[Math.max(0, Math.floor(turn))] ?? 0;
  return Math.min(1, Math.max(0, p));
}

/** Is there enough of a clock to read? */
export function usableClock(clock: ClockSignal | null | undefined): clock is ClockSignal {
  return !!clock && clock.runs >= SPEED_MIN_RUNS && clock.assembledBy.length > SPEED_TURN;
}

export interface SpeedReading {
  /** The bracket whose expectation this is read against. */
  bracket: number;
  /** The earliest turn that bracket expects, or null when it sets none (Bracket 5). */
  expectedTurn: number | null;
  /** The turn the share is "before": the expected turn, or Bracket 4's for Bracket 5. */
  beforeTurn: number;
  /** Share of games assembled before `beforeTurn`, 0-1, with its 95% Wilson interval. */
  share: number;
  low: number;
  high: number;
  runs: number;
}

/**
 * The clock read against a bracket's expectation: how many games assemble the
 * win path before the earliest turn the bracket expects. Bracket 5 expects no
 * minimum, so it is read against Bracket 4's turn 4 as a reference only.
 */
export function readSpeed(
  clock: ClockSignal | null | undefined,
  bracket: number
): SpeedReading | null {
  if (!usableClock(clock)) return null;
  const b = (Math.min(5, Math.max(1, Math.round(bracket))) || 3) as 1 | 2 | 3 | 4 | 5;
  const expectedTurn = b === 5 ? null : TURN_EXPECTATIONS[b];
  const beforeTurn = expectedTurn ?? TURN_EXPECTATIONS[4];
  const share = shareByTurn(clock, beforeTurn - 1);
  const { low, high } = wilson(Math.round(share * clock.runs), clock.runs);
  return {
    bracket: b,
    expectedTurn,
    beforeTurn,
    share,
    low,
    high,
    runs: clock.runs,
  };
}
