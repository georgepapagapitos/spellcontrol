import { cluesFor, type Clue } from './clues';
import { attrsOf, findCard } from './data';
import type { Puzzle } from './puzzle';
import { mainType, scoreGuess, type Mark, type Rarity } from './score';

export const MAX_GUESSES = 6;
export const MAX_ART_LEVEL = 5;

export type Status = 'playing' | 'solved' | 'failed';

/** A rejected play; the message is shown to the player as is. */
export class PlayError extends Error {}

export interface PlayState {
  /** Canonical card names, oldest first. */
  guesses: string[];
  gaveUp: boolean;
}

export interface GuessRow {
  name: string;
  cells: {
    colors: { value: string; mark: Mark };
    mv: { value: number; mark: Mark };
    type: { value: string; mark: Mark };
    rarity: { value: Rarity; mark: Mark };
    year: { value: number; mark: Mark };
  };
}

export interface PlayResponse {
  date: string;
  number: number;
  maxGuesses: number;
  status: Status;
  guesses: GuessRow[];
  clues: Clue[];
  artLevel: number | null;
  answer: null | {
    name: string;
    typeLine: string;
    setName: string;
    year: number;
    colors: string;
    art: string;
  };
}

export function statusOf(state: PlayState, answerName: string): Status {
  if (state.guesses.includes(answerName)) return 'solved';
  if (state.gaveUp || state.guesses.length >= MAX_GUESSES) return 'failed';
  return 'playing';
}

/** Add one guess to the state, or throw a PlayError saying why not. */
export function addGuess(state: PlayState, raw: unknown, answerName: string): PlayState {
  if (statusOf(state, answerName) !== 'playing') {
    throw new PlayError("Today's card is already finished.");
  }
  const card = typeof raw === 'string' ? findCard(raw) : null;
  if (!card) throw new PlayError('No card by that name. Pick one from the list.');
  if (state.guesses.includes(card.name)) {
    throw new PlayError(`You've already guessed ${card.name}.`);
  }
  return { ...state, guesses: [...state.guesses, card.name] };
}

function rowFor(name: string, puzzle: Puzzle): GuessRow | null {
  const card = findCard(name);
  if (!card) return null;
  const mark = scoreGuess(card, attrsOf(puzzle.payload));
  return {
    name: card.name,
    cells: {
      colors: { value: card.colors, mark: mark.colors },
      mv: { value: card.mv, mark: mark.mv },
      type: { value: mainType(card.typeLine), mark: mark.type },
      rarity: { value: card.rarity, mark: mark.rarity },
      year: { value: card.year, mark: mark.year },
    },
  };
}

/** The response for a state. While playing it holds only what the misses have unlocked. */
export function buildResponse(puzzle: Puzzle, state: PlayState): PlayResponse {
  const status = statusOf(state, puzzle.name);
  const finished = status !== 'playing';
  const rows = state.guesses.map((g) => rowFor(g, puzzle)).filter((r): r is GuessRow => r !== null);
  const misses = state.guesses.filter((g) => g !== puzzle.name).length;
  const clues = cluesFor(puzzle.payload);
  const p = puzzle.payload;
  return {
    date: puzzle.date,
    number: puzzle.number,
    maxGuesses: MAX_GUESSES,
    status,
    guesses: rows,
    clues: finished ? clues : clues.slice(0, Math.min(clues.length, 1 + misses)),
    artLevel: finished ? null : Math.min(misses, MAX_ART_LEVEL),
    answer: finished
      ? {
          name: p.name,
          typeLine: p.typeLine,
          setName: p.setName,
          year: p.year,
          colors: p.colors,
          art: p.art,
        }
      : null,
  };
}
