import { SCORE_KEYS, type GuessScore, type Mark } from './score';
import { MAX_GUESSES } from './stats';

// The share grid is the Wordle convention: squares that say how close each
// guess came and never what it was. Arrows count as a miss here, since a square
// can't point.
const SQUARE: Record<Mark, string> = {
  hit: '\u{1F7E9}',
  near: '\u{1F7E8}',
  miss: '⬛',
  higher: '⬛',
  lower: '⬛',
};

/** One grid row: five squares in cell order. */
export function shareRow(score: GuessScore): string {
  return SCORE_KEYS.map((k) => SQUARE[score[k]]).join('');
}

/**
 * The text a player posts: puzzle number, guesses used (X when unsolved), the
 * grid, and the link. Card names never appear, so it can't spoil the day.
 */
export function buildShareText(opts: {
  number: number;
  solved: boolean;
  scores: readonly GuessScore[];
  url: string;
}): string {
  const tally = opts.solved ? `${opts.scores.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const grid = opts.scores.map(shareRow).join('\n');
  return `SpellControl Daily #${opts.number} ${tally}\n${grid}\n${opts.url}`;
}
