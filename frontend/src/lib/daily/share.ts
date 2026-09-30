import type { Mark, ScoredGuess } from './daily-client';

// The share grid is the Wordle convention: squares that say how close each
// guess came and never what it was. Arrows count as a miss here, since a
// square can't point.
const SQUARE: Record<Mark, string> = {
  hit: '\u{1F7E9}',
  near: '\u{1F7E8}',
  miss: '⬛',
  higher: '⬛',
  lower: '⬛',
};

const ORDER = ['colors', 'mv', 'type', 'rarity', 'year'] as const;

/** One grid row: five squares in cell order. */
export function shareRow(guess: ScoredGuess): string {
  return ORDER.map((k) => SQUARE[guess.cells[k].mark]).join('');
}

/**
 * The text a player posts: puzzle number, guesses used (X when unsolved), the
 * grid, and the link. Card names never appear, so it can't spoil the day.
 */
export function buildShareText(opts: {
  number: number;
  solved: boolean;
  maxGuesses: number;
  guesses: readonly ScoredGuess[];
  url: string;
}): string {
  const tally = opts.solved ? `${opts.guesses.length}/${opts.maxGuesses}` : `X/${opts.maxGuesses}`;
  const grid = opts.guesses.map(shareRow).join('\n');
  return `SpellControl Daily #${opts.number} ${tally}\n${grid}\n${opts.url}`;
}
