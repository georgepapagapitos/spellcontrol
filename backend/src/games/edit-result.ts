import { reseatSummaryWinner, type GameSummary } from '@spellcontrol/game-core';
import type { GameResultParticipant } from './result-types';
import type { ResultEdit } from './local-result';

/**
 * Apply a recorder's correction to a stored LOCAL result.
 *
 * Pure, and deliberately confined to the two attribution fields a human types
 * by hand — the winner and each seat's deck. Everything derived from the event
 * log (damage, first blood, turns, elimination order) is left exactly as the
 * device witnessed it, because the log itself is not stored and nothing here
 * could honestly recompute it.
 *
 * The one derived field that MUST move is `summary.placement` — see
 * `reseatSummaryWinner` in @spellcontrol/game-core, which owns that rule so
 * the client can show the same correction before this ever runs.
 *
 * Callers validate first: every seat in `edit` must exist, and an eliminated
 * seat may not be named the winner (the persist path refuses that too, so an
 * edit must not be a way around it).
 */
export function applyResultEdit(
  participants: GameResultParticipant[],
  summary: GameSummary | null,
  edit: ResultEdit
): {
  participants: GameResultParticipant[];
  winnerSeat: number | null;
  winnerUserId: string | null;
  summary: GameSummary | null;
} {
  const nextParticipants = participants.map((p) => {
    const deck = edit.decks.get(p.seat);
    return deck === undefined ? p : { ...p, ...deck };
  });

  const winner =
    edit.winnerSeat === null ? undefined : nextParticipants.find((p) => p.seat === edit.winnerSeat);

  const eliminated = new Set(nextParticipants.filter((p) => p.eliminated).map((p) => p.seat));
  const nextSummary: GameSummary | null =
    summary === null ? null : reseatSummaryWinner(summary, edit.winnerSeat, eliminated);

  return {
    participants: nextParticipants,
    winnerSeat: edit.winnerSeat,
    winnerUserId: winner?.userId ?? null,
    summary: nextSummary,
  };
}
