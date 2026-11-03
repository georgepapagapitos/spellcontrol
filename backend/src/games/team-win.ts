import { isWinningSeat } from '@spellcontrol/game-core';

/**
 * Whether an account won a finished game. A Two-Headed Giant win belongs to a
 * team but `winner_seat` / `winner_user_id` store only the team's lowest seat,
 * so a bare `winner_user_id = userId` credits one teammate and charges the
 * other a loss. Team membership is derived here from the stored `format` and
 * seats (the same `isWinningSeat` rule the reducer uses), so rows written
 * before this existed read correctly with no data rewrite.
 */
export function userWon(
  game: {
    format: string;
    winnerSeat: number | null;
    winnerUserId: string | null;
    participants: ReadonlyArray<{ seat: number; userId: string | null }>;
  },
  userId: string
): boolean {
  if (game.winnerUserId === userId) return true;
  // Only a team format can credit a seat beyond the stored winner.
  if (game.format !== '2hg') return false;
  const mine = game.participants.find((p) => p.userId === userId);
  return mine != null && isWinningSeat(game, mine.seat);
}

/**
 * SQL twin of `userWon` over a `game_results`-shaped row aliased `alias`
 * (needs `format`, `winner_seat`, `winner_user_id`, `participants`), for
 * `userExpr` (a bind parameter or column). Non-team rows reduce to the plain
 * `winner_user_id = userExpr` comparison. Seats pair as floor(seat / 2), the
 * same fixed rule as `teamOf`.
 */
export function userWonSql(alias: string, userExpr: string): string {
  return `(${alias}.winner_user_id = ${userExpr}
     OR (${alias}.format = '2hg' AND ${alias}.winner_seat IS NOT NULL AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(${alias}.participants) tp
        WHERE tp->>'userId' = ${userExpr}
          AND (tp->>'seat')::int / 2 = ${alias}.winner_seat / 2)))`;
}
