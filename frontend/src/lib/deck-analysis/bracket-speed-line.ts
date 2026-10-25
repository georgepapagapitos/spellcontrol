import { TURN_EXPECTATIONS, type SpeedReading } from '@spellcontrol/deck-metrics';
import { clockShare } from '@/lib/mana-sim/opening-hand-sim';

/** The turns the speed read lays out: each bracket's earliest expected turn, 4 to 9. */
export const SPEED_MILESTONES: ReadonlyArray<{ bracket: 1 | 2 | 3 | 4; turn: number }> = [
  { bracket: 4, turn: TURN_EXPECTATIONS[4] },
  { bracket: 3, turn: TURN_EXPECTATIONS[3] },
  { bracket: 2, turn: TURN_EXPECTATIONS[2] },
  { bracket: 1, turn: TURN_EXPECTATIONS[1] },
];

/**
 * The speed read in one sentence: how often the win path is in place before the
 * turn the bracket expects games to last to, out of how many simulated games,
 * and the turn Wizards' update gives that bracket. An estimate from a goldfish,
 * so the sample size always rides with the share.
 */
export function bracketSpeedLine(r: SpeedReading): string {
  const games = r.runs.toLocaleString();
  const how =
    r.share === 0
      ? `in none of ${games} simulated games`
      : r.share === 1
        ? `in every one of ${games} simulated games`
        : `in ${clockShare(r.share)} of games (${games} simulated)`;
  const expects =
    r.expectedTurn === null
      ? `Bracket ${r.bracket} sets no turn expectation.`
      : `Bracket ${r.bracket} expects turn ${r.expectedTurn} or later.`;
  return `Comes together before turn ${r.beforeTurn} ${how}; ${expects}`;
}
