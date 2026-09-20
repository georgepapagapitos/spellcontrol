import { useMemo } from 'react';
import { usePlayStore } from '@/store/play';
import { useTableSeat } from './use-table-seat';

/**
 * The signal half of the same linkage `useOnlineTable` uses — chat,
 * reactions, dice, pointing and holds — kept separate because those need
 * only the seat, not the board-publish side effect or the opponent-roster
 * projection.
 *
 * The condition itself is NOT re-derived here any more. It used to be, and
 * that was the bug: when the table link grew a deck test, these five write
 * paths kept the old seat-only rule and went on posting chat, reactions and
 * dice rolls into a game the board was not playing in. Both hooks now ask
 * `useTableSeat`.
 *
 * Returns null in solo playtest, online but unseated, or seated while
 * goldfishing a different deck — in which case callers render nothing.
 */
export function useOnlineSignals() {
  const onlineSignal = usePlayStore((s) => s.onlineSignal);
  const sendSignal = usePlayStore((s) => s.sendSignal);
  const link = useTableSeat();

  return useMemo(() => {
    if (!link) return null;
    return { online: link.online, mySeat: link.seat.seat, onlineSignal, sendSignal };
  }, [link, onlineSignal, sendSignal]);
}
