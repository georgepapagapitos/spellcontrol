/**
 * Shapes for the canonical finished-game record (`game_results`). Kept
 * dependency-free so both the Drizzle schema and the read routes can import
 * them without a cycle.
 */

/** One seat in a finished game. `userId`/deck/commander are null for guest seats. */
export interface GameResultParticipant {
  seat: number;
  userId: string | null;
  /** Denormalized at write time (no rename feature) so reads need no users join. */
  username: string | null;
  /** In-game display name; the fallback when `username` is null. */
  name: string;
  deckId: string | null;
  deckName: string | null;
  commander: string | null;
  /** Captured here because GameRecord/gameToRecord() drops it. */
  colorIdentity: string[];
  finalLife: number;
  eliminated: boolean;
}

/** Public projection of a `game_results` row returned by the read routes. */
export interface PublicGameResult {
  sessionId: string;
  code: string;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: GameResultParticipant[];
}
