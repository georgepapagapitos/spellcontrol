import { useCallback, useMemo, useState } from 'react';
import { haptics } from '@/lib/util/haptics';
import { toast } from '@/store/toasts';
import { usePlayStore } from '@/store/play';
import type { OnlineTable } from '../../hooks/use-online-table';
import { useTablePings } from '../../hooks/use-table-pings';

/**
 * Arrows and pings: the two "this one" gestures that reach the whole table.
 *
 * Arrows: a point that stays. W with one card selected starts one from it;
 * the next card tapped — yours, a quadrant's, or one in an opponent's
 * inspector — is where it lands. Everyone at the table sees it until its
 * author clears theirs (Shift+W, or the game menu). Online only: an arrow
 * with nobody to see it is a note to yourself, and the log already is one.
 *
 * Pings: tapping a card rings it, on every screen at the table, in the
 * color of the seat that tapped it. The lightest way to say "this one"
 * — no ticker line, no state, gone in a second. Solo still rings locally
 * (`send` null), because the ring is also the feedback that a tap landed.
 */
export function useBoardArrows(onlineTable: OnlineTable | null) {
  const sendSignal = usePlayStore((s) => s.sendSignal);
  const onlineArrows = usePlayStore((s) => s.onlineArrows);
  const [arrowFrom, setArrowFrom] = useState<{ seat: number; cardId: string } | null>(null);
  const beginArrow = useCallback(
    (cardIds: ReadonlySet<string>) => {
      if (!onlineTable) return false;
      if (cardIds.size !== 1) {
        toast.show({ message: 'Select the one card the arrow starts from, then press W.' });
        return;
      }
      setArrowFrom({ seat: onlineTable.mySeat, cardId: [...cardIds][0] });
      haptics.tap();
    },
    [onlineTable]
  );
  const finishArrow = useCallback(
    (toSeat: number, toCardId?: string) => {
      if (!arrowFrom) return;
      void sendSignal({
        kind: 'arrow',
        op: 'add',
        fromSeat: arrowFrom.seat,
        fromCardId: arrowFrom.cardId,
        toSeat,
        ...(toCardId !== undefined && { toCardId }),
      });
      setArrowFrom(null);
      haptics.tap();
    },
    [arrowFrom, sendSignal]
  );
  const clearMyArrows = useCallback(() => {
    if (!onlineTable) return false;
    void sendSignal({ kind: 'arrow', op: 'clear' });
    setArrowFrom(null);
  }, [onlineTable, sendSignal]);
  const myArrowCount = onlineTable
    ? onlineArrows.filter((a) => a.seat === onlineTable.mySeat).length
    : 0;
  const sendPing = useMemo(() => {
    if (!onlineTable) return null;
    const seat = onlineTable.mySeat;
    return (cardId: string) => {
      void sendSignal({ kind: 'ping', targetSeat: seat, cardId });
    };
  }, [onlineTable, sendSignal]);
  const { pings, ping } = useTablePings(onlineTable?.mySeat ?? null, sendPing);

  return {
    sendSignal,
    arrowFrom,
    setArrowFrom,
    beginArrow,
    finishArrow,
    clearMyArrows,
    myArrowCount,
    pings,
    ping,
  };
}
