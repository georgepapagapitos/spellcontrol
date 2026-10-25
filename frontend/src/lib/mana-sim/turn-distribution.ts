/**
 * The one shape a simulated "on which turn does it happen" answer takes.
 *
 * The assembly clock ("the combo is online by turn N") and the goldfish
 * manabase simulator are both Monte-Carlo games that end, for a given goal, on
 * some turn. This module turns the per-game turns into a distribution: a
 * median, the slow tail (p90), the fast tail (the "ceiling": the best 5% of
 * games), the run count, and for every turn the share of games finished by it
 * with its Wilson interval. A caller shows the run count and the interval so a
 * "34%" out of 200 games doesn't read like a "34%" out of 20,000.
 */

/** Share of games done by a turn, with its 95% Wilson score interval. */
export interface TurnShare {
  p: number;
  lo: number;
  hi: number;
}

export interface TurnDistribution {
  /** Games simulated. */
  runs: number;
  /** Median 1-based turn the goal was met. */
  typicalTurn: number;
  /** 90th-percentile turn: 90% of games met the goal by this turn. */
  p90Turn: number;
  /** The best 5% of games: the turn by which 1 game in 20 had met the goal. */
  ceilingTurn: number;
  /**
   * Share of games (0-1) that met the goal by turn t, indexed by turn up to
   * `DISTRIBUTION_TURNS`; index 0 is 0.
   */
  assembledBy: number[];
  /** `assembledBy` with its Wilson interval, same indexing. */
  byTurn: TurnShare[];
  /**
   * Set when games were cut off at this turn: a game that had not met the goal
   * by then is recorded as `horizon + 1`, so any figure above `horizon` means
   * "not by turn `horizon`" (see `turnLabel`).
   */
  horizon?: number;
}

/** How many turns `TurnDistribution.assembledBy` covers. */
export const DISTRIBUTION_TURNS = 20;

/**
 * The turn the clock stops simulating at. Every figure the app shows is a
 * median or p90 turn or a share by turn 20; a corpus of 20 commanders put the
 * slowest p90 at turn 59, so 60 leaves every shown number exact and spares the
 * games that never assemble from playing out the whole library.
 */
export const CLOCK_HORIZON = 60;

/** A turn figure as text: "35", or "60+" for a game cut off at the horizon. */
export function turnLabel(d: Pick<TurnDistribution, 'horizon'>, turn: number): string {
  return d.horizon !== undefined && turn > d.horizon ? `${d.horizon}+` : String(turn);
}

/** z for a 95% interval. */
const Z95 = 1.959964;

/**
 * Wilson score interval for `successes` out of `n` (default 95%). Unlike the
 * normal approximation it stays inside [0, 1] and is not degenerate at 0 or n,
 * which is exactly where a "never in 1,000 games" claim lives.
 */
export function wilsonInterval(successes: number, n: number, z = Z95): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Summarize the turn each game met its goal on. `turns` need not be sorted.
 * The percentile rule is the clock's own (the element at floor(n * q) of the
 * sorted turns), so the median and p90 are the numbers the app has always shown.
 */
export function summarizeTurns(turns: readonly number[], horizon?: number): TurnDistribution {
  const sorted = [...turns].sort((a, b) => a - b);
  const n = sorted.length;
  const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(n * q))];
  const assembledBy = [0];
  const byTurn: TurnShare[] = [{ p: 0, lo: 0, hi: 0 }];
  for (let t = 1, i = 0; t <= DISTRIBUTION_TURNS; t++) {
    while (i < n && sorted[i] <= t) i++;
    assembledBy.push(i / n);
    byTurn.push({ p: i / n, ...wilsonInterval(i, n) });
  }
  return {
    runs: n,
    typicalTurn: at(0.5),
    p90Turn: at(0.9),
    ceilingTurn: at(0.05),
    assembledBy,
    byTurn,
    ...(horizon === undefined ? {} : { horizon }),
  };
}
