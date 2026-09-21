import type { GameSummary } from '@spellcontrol/game-core';
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
 * The one derived field that MUST move is `summary.placement`: the summarizer
 * stamps the winner as 1st, so leaving a stale 1 on the old winner would have
 * the same row claim two first places. Eliminated seats keep the placement
 * their elimination order earned; a survivor who is no longer the winner goes
 * back to `null`, the same "no placement" the summarizer gives a living seat.
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
    summary === null
      ? null
      : {
          ...summary,
          winnerSeat: edit.winnerSeat,
          seats: summary.seats.map((s) => {
            if (s.seat === edit.winnerSeat) return { ...s, placement: 1 };
            if (s.placement === 1 && !eliminated.has(s.seat)) return { ...s, placement: null };
            return s;
          }),
        };

  return {
    participants: nextParticipants,
    winnerSeat: edit.winnerSeat,
    winnerUserId: winner?.userId ?? null,
    summary: nextSummary,
  };
}
