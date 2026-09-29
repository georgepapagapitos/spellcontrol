import { reseatSummaryWinner, type GameRecord, type GameState } from './game-state';
import type { GameResultEdit } from './game-results-client';

/**
 * Show a recorder's correction (winner, deck attribution) on the history row
 * right away, rather than waiting for the round-trip — and carry it on a game
 * that has not been uploaded yet, which has no server row to correct at all.
 *
 * The placement rule lives in @spellcontrol/game-core so this and the server's
 * write can never disagree about which seat came first.
 */

function deckFor(edit: GameResultEdit, seat: number) {
  return edit.decks.find((d) => d.seat === seat);
}

export function applyEditToRecord(rec: GameRecord, edit: GameResultEdit): GameRecord {
  const players = rec.players.map((p) => {
    const deck = deckFor(edit, p.seat);
    return deck === undefined
      ? p
      : { ...p, deckId: deck.deckId, deckName: deck.deckName, commander: deck.commander };
  });
  const eliminated = new Set(players.filter((p) => p.eliminated).map((p) => p.seat));
  return {
    ...rec,
    players,
    winnerSeat: edit.winnerSeat,
    ...(rec.summary
      ? { summary: reseatSummaryWinner(rec.summary, edit.winnerSeat, eliminated) }
      : {}),
  };
}

/**
 * The same correction against the queued `GameState` a local game still holds
 * before it reaches the server, so the eventual upload carries the fix instead
 * of overwriting the row with the mistake.
 */
export function applyEditToState(state: GameState, edit: GameResultEdit): GameState {
  return {
    ...state,
    winnerSeat: edit.winnerSeat,
    players: state.players.map((p) => {
      const deck = deckFor(edit, p.seat);
      return deck === undefined
        ? p
        : {
            ...p,
            deckId: deck.deckId,
            deckName: deck.deckName,
            commander: deck.commander,
            colorIdentity: deck.colorIdentity,
          };
    }),
  };
}
