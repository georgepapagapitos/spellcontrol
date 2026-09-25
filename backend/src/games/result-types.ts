/**
 * Shapes for the canonical finished-game record (`game_results`). Kept
 * dependency-free so both the Drizzle schema and the read routes can import
 * them without a cycle.
 */

import type { GameEvent, GameSummary } from '@spellcontrol/game-core';

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
  /** Second commander for a Partner pair. Null for the common single-commander
   *  seat. Captured here (rather than left for GameRecord to infer) for the
   *  same reason as colorIdentity below. */
  partner: string | null;
  /** Captured here because GameRecord/gameToRecord() drops it. */
  colorIdentity: string[];
  finalLife: number;
  eliminated: boolean;
}

export type GameResultMode = 'local' | 'online';

/** Public projection of a `game_results` row returned by the read routes. */
export interface PublicGameResult {
  sessionId: string;
  code: string;
  /** 'online' (server-written when the session finished) or 'local' (posted
   *  by the device that tracked the table). Both live in one table so every
   *  stats read counts both and can split by this field. */
  mode: GameResultMode;
  /** Who posted a local result; null for online rows. Only they may delete it. */
  recordedByUserId: string | null;
  /**
   * Who hosted an ONLINE game — the only account that may delete that row.
   * Null for local rows, and for online rows recorded before this was captured
   * (those remain hide-only).
   */
  hostUserId: string | null;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: GameResultParticipant[];
  /** Selected via selectNotableEvents() at persist time. Null only for rows
   *  written before this column existed — never coerced to []; see
   *  persist-result.ts for the "ran the selector, found nothing" vs
   *  "pre-migration row" distinction. */
  notableEvents: GameEvent[] | null;
  /** Derived stats via summarizeGame() at persist time. Null only for rows
   *  written before this column existed; the rollups in games/rollup.ts
   *  exclude such games rather than scoring them as zeroes. */
  summary: GameSummary | null;
  /** Co-op outcome (format = 'horde' only) — the whole table wins or loses
   *  together, so there is no winnerSeat/winnerUserId on these rows. Null for
   *  every other format. */
  coopOutcome: 'won' | 'lost' | null;
  /** Which horde deck a co-op game was fought against. Null otherwise. */
  hordeId: string | null;
  /** Which way the table sat. Null for a legacy row (recorded before this
   *  column existed) and for an explicitly clockwise table — both read as
   *  clockwise, matching `GameState.turnOrder`'s own convention. */
  turnOrder: 'clockwise' | 'counterclockwise' | null;
  /**
   * The two rule toggles the table played with. Null only for a row recorded
   * before these columns existed — every row written from here on always
   * carries a real boolean, since `GameState.commanderDamageEnabled` /
   * `poisonEnabled` are required fields, never absent on a live game.
   */
  commanderDamageEnabled: boolean | null;
  poisonEnabled: boolean | null;
}
