import { isWinningSeat } from '@spellcontrol/game-core';

/**
 * Who the finished table names as the winner. A Two-Headed Giant win belongs
 * to a team, so the name reads "Maya & Sam" and the verb is plural; every
 * other format names the one seat. Null for a draw, or a winner who is no
 * longer seated.
 */
export function winnerOf(game: {
  format: string;
  players: ReadonlyArray<{ seat: number; name: string }>;
  winnerSeat: number | null;
}): { name: string; plural: boolean } | null {
  if (game.winnerSeat == null) return null;
  const seated = game.players.filter((p) => isWinningSeat(game, p.seat));
  if (!seated.some((p) => p.seat === game.winnerSeat)) return null;
  return { name: seated.map((p) => p.name).join(' & '), plural: seated.length > 1 };
}
