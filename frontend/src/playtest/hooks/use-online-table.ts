import { useEffect, useMemo } from 'react';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { publishBoard } from '@/lib/games-board';
import { toPublicBoard, type PublicBoard } from '@/lib/playtest/projection';
import type { PlaytestState } from '@/lib/playtest';
import type { OpponentSeat } from '../components/OpponentRail';

export interface OnlineTable {
  /** Seat currently on turn per the online session, if any. */
  activeSeat: number | null;
  /** Every OTHER seated player, ready for `<OpponentRail>`. */
  opponents: OpponentSeat[];
  /** This device's own seat in the active online game — never null when
   *  `OnlineTable` is non-null (that's exactly the condition that produces
   *  one). Consumed by the takeback cross-seat request channel to key
   *  `onlineRequests` (see store/play.ts), which is keyed by requester seat. */
  mySeat: number;
}

/** A seated player who hasn't published a board yet this session (just
 *  joined, or hasn't touched their battlefield). `life` is real — the online
 *  session tracks it independently of playtest publishing — but the rest is
 *  deliberately zeroed rather than borrowed from a real board: a fresh
 *  Commander hand is 7 cards and the library is ~90+, so faking `handCount`/
 *  `libraryCount` at 0 would misreport a player who simply hasn't published
 *  yet as already topdecking. `pending: true` on the `OpponentSeat` tells
 *  `OpponentRail` to show a distinct "no board shared yet" state instead. */
function pendingBoard(seat: number, life: number): PublicBoard {
  return {
    seat,
    turn: 0,
    life,
    commanderTax: {},
    monarch: false,
    initiative: false,
    citysBlessing: false,
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    handCount: 0,
    libraryCount: 0,
  };
}

/**
 * The conditional multiplayer seam: playtest and online games are otherwise
 * independent worlds. This hook is the single place that decides whether
 * they're linked for the current render — derived, not a mode toggle: linked
 * exactly when `usePlayStore().online` exists AND this device holds a seat in
 * it (same `userId` match `GameBoard` uses to find "which panel is mine").
 *
 * When linked: publishes `state` (debounced inside `publishBoard`, so this
 * calls it on every change rather than adding a second debounce) and returns
 * the roster for `<OpponentRail>`. When not linked, returns null having done
 * no projection and made no network call — solo playtest pays only the cost
 * of the two lightweight store subscriptions below, which is what makes the
 * link "derived" instead of a route/flag a solo session has to opt out of.
 */
export function useOnlineTable(state: PlaytestState): OnlineTable | null {
  const online = usePlayStore((s) => s.online);
  const onlineBoards = usePlayStore((s) => s.onlineBoards);
  const userId = useAuth((s) => s.user?.id ?? null);

  const mine = useMemo(
    () =>
      online && userId != null ? (online.players.find((p) => p.userId === userId) ?? null) : null,
    [online, userId]
  );
  const code = online?.code ?? null;
  const mySeat = mine?.seat ?? null;

  useEffect(() => {
    if (code == null || mySeat == null) return;
    publishBoard(code, toPublicBoard(state, mySeat));
  }, [code, mySeat, state]);

  return useMemo(() => {
    if (!online || !mine) return null;
    const opponents: OpponentSeat[] = online.players
      .filter((p) => p.seat !== mine.seat)
      .map((p) => {
        const board = onlineBoards[p.seat];
        return board
          ? { name: p.name, board }
          : { name: p.name, board: pendingBoard(p.seat, p.life), pending: true };
      });
    return { activeSeat: online.activeSeat, opponents, mySeat: mine.seat };
  }, [online, mine, onlineBoards]);
}
