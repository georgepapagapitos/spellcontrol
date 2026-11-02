import type { SpeedReading } from '@spellcontrol/deck-metrics';
import { clockShare } from '@/lib/mana-sim/opening-hand-sim';
import { gameChangersLabel } from '@/lib/play/pod-sheet';

/**
 * The pregame card's speed row: the share of simulated games where the win path
 * is in place before the turn the bracket expects games to last to, with the
 * Wizards turn band beside it. The same reading as the Bracket panel's speed
 * line (`bracketSpeedLine`), cut down to fit a card.
 */
export interface PregameSpeed {
  /** "22% of games", "none of 1,000 games". */
  value: string;
  /** "before turn 6" */
  when: string;
  /** "Bracket 3 expects turn 6 or later" */
  band: string;
  /** "1,000 simulated games" */
  sample: string;
}

export function pregameSpeed(r: SpeedReading): PregameSpeed {
  const games = r.runs.toLocaleString();
  const value =
    r.share === 0
      ? `none of ${games} games`
      : r.share === 1
        ? `all ${games} games`
        : `${clockShare(r.share)} of games`;
  const band =
    r.expectedTurn === null
      ? `Bracket ${r.bracket} sets no turn expectation`
      : `Bracket ${r.bracket} expects turn ${r.expectedTurn} or later`;
  return {
    value,
    when: `before turn ${r.beforeTurn}`,
    band,
    sample: `${games} simulated games`,
  };
}

export interface PregameFacts {
  deckName: string;
  /** "Bracket 3", "Bracket 3+", "Bracket 4 (estimate 3)". */
  bracketText: string;
  gameChangers: number | null;
  speed: SpeedReading | null;
  url: string;
}

/** The card as plain text, for a share sheet or the clipboard. */
export function pregameShareText(f: PregameFacts): string {
  const parts = [f.bracketText];
  if (f.gameChangers !== null) parts.push(gameChangersLabel(f.gameChangers));
  if (f.speed) {
    const s = pregameSpeed(f.speed);
    parts.push(`Win path ${s.when} in ${s.value}`);
  }
  return `${f.deckName}: ${parts.join(', ')}. ${f.url}`;
}
