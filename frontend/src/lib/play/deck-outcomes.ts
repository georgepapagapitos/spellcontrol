import type { GameRecord } from '@spellcontrol/game-core';
import { seatCountsForDeck } from '@/lib/play/table-read';

/**
 * Fewest games before the panel sets observed turns beside the forecast. Five
 * is where a median is the middle one of five games rather than a game or two,
 * and the range is shown with it so the spread is visible. It is a floor for
 * saying anything, not a claim of statistical power: a handful of games reads
 * as a hint, and the copy says so.
 */
export const OUTCOME_MIN_GAMES = 5;

export interface VersionOutcomes {
  /** Games with this list whose pod passed turns, so a length is known. */
  lengths: number[];
  /** Of those, the games this deck won. */
  winLengths: number[];
  /** All tracked games with this list, passed turns or not. */
  games: number;
  wins: number;
}

export interface DeckOutcomes {
  /** The list as it stands now. */
  current: VersionOutcomes;
  /** Games played with a different, earlier-recorded list. */
  otherVersions: number;
  /** Games recorded before versions were captured (or with a deck reassigned
   *  after the fact): they cannot be matched to any list. */
  unversioned: number;
}

/**
 * How long a game ran, in rounds: every seat's pass is one turn, so a pod of
 * four that passed eleven times is in round three. Null when the pod never
 * passed turns (nothing was tracked, which is not a zero-turn game). Same rule
 * as the game recap.
 */
export function gameRounds(rec: GameRecord): number | null {
  const turns = rec.summary?.turns ?? 0;
  if (turns <= 0 || rec.players.length === 0) return null;
  return Math.max(1, Math.ceil(turns / rec.players.length));
}

/** The middle value, taking the lower of two: "at least half the games ended by this round". */
export function lowerMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/**
 * This deck's tracked games, split by whether they were played with the list it
 * holds now. Counts what the Table record counts (`seatCountsForDeck`), so the
 * two never disagree about which games are this deck's.
 */
export function deckOutcomes(
  history: readonly GameRecord[],
  userId: string | null,
  deckId: string,
  version: string
): DeckOutcomes {
  const current: VersionOutcomes = { lengths: [], winLengths: [], games: 0, wins: 0 };
  let otherVersions = 0;
  let unversioned = 0;
  for (const rec of history) {
    for (const p of rec.players) {
      if (p.deckId !== deckId || !seatCountsForDeck(rec, p, userId)) continue;
      if (!p.deckVersion) {
        unversioned += 1;
        continue;
      }
      if (p.deckVersion !== version) {
        otherVersions += 1;
        continue;
      }
      current.games += 1;
      const won = rec.winnerSeat === p.seat;
      if (won) current.wins += 1;
      const rounds = gameRounds(rec);
      if (rounds === null) continue;
      current.lengths.push(rounds);
      if (won) current.winLengths.push(rounds);
    }
  }
  return { current, otherVersions, unversioned };
}
