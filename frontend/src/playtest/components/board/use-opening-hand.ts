import { useEffect } from 'react';
import { usePlayStore } from '@/store/play';
import type { OnlineTable } from '../../hooks/use-online-table';
import { usePlaytestStore } from '../../store';

/**
 * Where the opening hand is: the phase and mulligan count, the rest of the
 * table's wait online, and whether the takeover owns the screen.
 */
export function useOpeningHand(onlineTable: OnlineTable | null) {
  const phase = usePlaytestStore((s) => s.phase);
  const mulliganCount = usePlaytestStore((s) => s.mulliganCount);
  const setTableMulliganType = usePlaytestStore((s) => s.setTableMulliganType);
  // A finished table can never resolve a wait that depends on the rest of
  // the table doing something (E351 follow-up) — see `openingOnline` below,
  // the one place that wait lives.
  const tableFinished = usePlayStore((s) => s.online?.status === 'finished');
  // The table's mulligan rule is the pod's, so it lives in the store for the
  // whole session rather than being read at the one call site — the store is
  // what decides whether a kept hand owes the bottom anything.
  const onlineMulliganType = onlineTable?.mulliganType ?? null;
  useEffect(() => {
    setTableMulliganType(onlineMulliganType);
  }, [onlineMulliganType, setTableMulliganType]);

  // Online, keeping your opening hand doesn't start the game — the takeover
  // stays up until every other seat has kept too. A seat with no published
  // board, or one whose board predates `keptHand`, reads as still choosing.
  // `every()` on an empty list is true, so the count must be checked: seated
  // alone, the table waits for someone to join rather than counting itself in.
  // `tableFinished` short-circuits this to `undefined`: a wait for the rest
  // of the table can never resolve once the table has ended (E351 follow-up)
  // — the curtain must drop and hand the board back, not strand the player
  // behind "Waiting for X" forever.
  const openingOnline =
    onlineTable && !tableFinished
      ? {
          waitingOn: onlineTable.opponents
            .filter((o) => o.board.keptHand !== true)
            .map((o) => o.name),
          allKept:
            onlineTable.opponents.length > 0 &&
            onlineTable.opponents.every((o) => o.board.keptHand === true),
        }
      : undefined;
  // The exact complement of `OpeningHandSheet`'s own mount condition
  // (`phase !== 'playing' || openingOnline`): the two can never both be
  // "showing" at once, so the drag hint never fights the takeover for the
  // same hand.
  const isChoosingHand = phase !== 'playing' || Boolean(openingOnline);

  return { phase, mulliganCount, onlineMulliganType, openingOnline, isChoosingHand };
}
