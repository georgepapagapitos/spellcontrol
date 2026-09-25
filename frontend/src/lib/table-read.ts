import type { GameRecord } from '@/lib/game-state';

/**
 * Does this seat's result belong to its deck in this viewer's record? One
 * rule for the Table record and the Bracket panel's read. Horde is co-op (no
 * winning seat; it has its own tally). Online games count only the viewer's
 * own seat; a local game shares one device, so every seat's deck counts.
 */
export function seatCountsForDeck(
  rec: GameRecord,
  seat: GameRecord['players'][number],
  userId: string | null
): boolean {
  if (rec.format === 'horde' || !seat.deckId) return false;
  return rec.mode !== 'online' || seat.userId === userId;
}

/** Below this many decided games the read says nothing about the bracket. */
export const TABLE_READ_MIN_GAMES = 10;

export interface TableRead {
  /** Decided games this deck played (a game with no winner doesn't count). */
  games: number;
  wins: number;
  /** Wins an even table would give it: one over the pod size, per game. */
  evenShare: number;
  /** null below `TABLE_READ_MIN_GAMES`: too few games to say anything. */
  verdict: 'above' | 'even' | 'below' | null;
}

/**
 * How the deck actually does, against an even share of wins. It's evidence
 * beside the estimate, never an input to it: the opponents' brackets are
 * unknown unless their decks are tracked too. Twice an even share or more
 * reads "above", half or less "below".
 */
export function deckTableRead(
  history: readonly GameRecord[],
  userId: string | null,
  deckId: string
): TableRead {
  let games = 0;
  let wins = 0;
  let evenShare = 0;
  for (const rec of history) {
    if (rec.winnerSeat === null) continue;
    for (const p of rec.players) {
      if (p.deckId !== deckId || !seatCountsForDeck(rec, p, userId)) continue;
      games += 1;
      evenShare += 1 / rec.players.length;
      if (rec.winnerSeat === p.seat) wins += 1;
    }
  }
  const verdict =
    games < TABLE_READ_MIN_GAMES
      ? null
      : wins >= 2 * evenShare
        ? 'above'
        : wins <= 0.5 * evenShare
          ? 'below'
          : 'even';
  return { games, wins, evenShare, verdict };
}
