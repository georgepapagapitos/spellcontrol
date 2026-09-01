import { useEffect, useState } from 'react';
import { usePlayStore } from '@/store/play';

/** How long a point stays lit. Long enough to look up from your own board
 *  and find what somebody indicated, short enough that the highlight is
 *  unambiguously about the play happening right now — a point that outlived
 *  its moment would have every seat hunting for a target already resolved.
 *  Deliberately longer than a reaction's 2.5s (TableSignals): a reaction is
 *  ambient, a point is asking the table to look at something. */
export const POINT_MS = 5000;

export interface TablePointer {
  /** Seat that raised the point. */
  seat: number;
  /** Seat whose board is being pointed at. */
  targetSeat: number;
  /** Card being pointed at, or undefined for a point at the seat as a whole
   *  (which also covers a card id no longer on the target's board — see the
   *  `cardId` contract on `GameSignal`). */
  cardId?: string;
}

/**
 * The currently-lit table point, or null.
 *
 * Points ride the ephemeral signal channel like reactions and rolls, so
 * there is no server-side "current pointer" to read — the store only ever
 * holds the LAST signal of any kind (`onlineSignal`). This hook turns that
 * edge into the short-lived state a highlight needs, and is the single owner
 * of that timer so the rail, the board modal, and the announcement layer all
 * light up and go dark together instead of each running its own clock.
 *
 * Non-point signals are ignored rather than clearing an active point: an
 * emote landing mid-point must not blank the highlight somebody is still
 * looking at.
 */
export function useTablePointer(): TablePointer | null {
  const onlineSignal = usePlayStore((s) => s.onlineSignal);
  const [pointer, setPointer] = useState<TablePointer | null>(null);

  useEffect(() => {
    const signal = onlineSignal?.signal;
    if (!signal || signal.kind !== 'point' || signal.targetSeat == null) return;
    const next: TablePointer = {
      seat: signal.seat,
      targetSeat: signal.targetSeat,
      cardId: signal.cardId,
    };
    // Deferred a microtask for the same reason TableSignals defers: this is
    // an event reaction to a store push, not derived state, and
    // react-hooks/set-state-in-effect forbids the direct call.
    queueMicrotask(() => setPointer(next));
    // Keyed on the signal identity (`seq`), so re-pointing at the same card
    // restarts the window rather than being swallowed as "no change".
  }, [onlineSignal]);

  // The expiry timer lives in its own effect keyed on the pointer it expires.
  // Folded into the effect above, its cleanup would cancel the timer on every
  // unrelated signal and pin a point lit forever (the same trap TickerFlash
  // documents).
  useEffect(() => {
    if (!pointer) return;
    const t = setTimeout(() => setPointer(null), POINT_MS);
    return () => clearTimeout(t);
  }, [pointer]);

  return pointer;
}
