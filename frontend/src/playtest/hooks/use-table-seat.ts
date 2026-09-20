import { useMemo } from 'react';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import type { GamePlayer, GameState } from '@/lib/game-state';
import { usePlaytestStore } from '../store';

/**
 * The one rule for "this playtest board IS my online seat's board", and the
 * only place it is spelled.
 *
 * Three things have to hold: there is an online game, this device holds a
 * seat in it, and **the deck on that seat is the deck this board is
 * playing**. The deck half is what makes the link per-board rather than
 * per-account.
 *
 * Without it, holding a seat was the whole test, so opening any other deck to
 * goldfish — including a shared or public deck, which reaches the same board
 * through `PlaytestSession` — quietly became your seat: it published that
 * board to the table, fed its log lines into the table ticker, took the
 * table's authoritative life total for its own, and armed chat, reactions,
 * dice, pointing and holds against a game it was not part of.
 *
 * It was derived independently in four places (this hook's two callers,
 * `HoldBanner`, and `PlaytestPage`), which is exactly how three of them came
 * to disagree with the fourth. Every seam that asks "am I seated here?" goes
 * through this; a seat with no deck picked yet is nobody's board, and the
 * board door's "pick a deck to open your board" is the route that sets it.
 *
 * Deliberately NOT gated on `status`: a finished game has to stay linked long
 * enough for `TableMoments` to run the win ceremony, which is the one thing
 * that reads status for itself.
 */
export function useTableSeat(): { online: GameState; seat: GamePlayer } | null {
  const online = usePlayStore((s) => s.online);
  const userId = useAuth((s) => s.user?.id ?? null);
  // The deck this board is actually playing. Null on a session that has not
  // initialised, which can never match a seat.
  const playtestDeckId = usePlaytestStore((s) => s.deckId);

  return useMemo(() => {
    if (!online || userId == null || playtestDeckId == null) return null;
    const seat = online.players.find((p) => p.userId === userId) ?? null;
    if (!seat || seat.deckId == null || seat.deckId !== playtestDeckId) return null;
    return { online, seat };
  }, [online, userId, playtestDeckId]);
}
