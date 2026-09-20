import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayStore } from '@/store/play';

/** How long one ring lives. Short on purpose: a ping says "this one, now",
 *  and a ring still fading when the next play starts would read as part of
 *  it. Long enough for an eye crossing the table to catch it. */
export const PING_MS = 1100;

/** Floor between two pings the same seat sends. A tap is a ping, and a busy
 *  combat step is a lot of taps — this keeps a normal turn well inside the
 *  server's per-minute signal budget without the player ever feeling it. */
const SEND_THROTTLE_MS = 450;

export interface TablePing {
  /** Unique per ring, so React keys and the expiry timer never collide when
   *  the same card is pinged twice in a row. */
  id: number;
  /** Seat that pinged — picks the ring's colour. */
  seat: number;
  /** Seat whose board the card is on. */
  targetSeat: number;
  cardId: string;
}

export interface TablePings {
  pings: readonly TablePing[];
  /** Ring a card on your own board, and tell the table if there is one. */
  ping(cardId: string): void;
}

/**
 * The rings currently lit on the table.
 *
 * A ping is the table's lightest signal: tapping a card rings it, on every
 * screen, in the colour of the seat that tapped it — which is how you say
 * "this one" without saying anything. It writes nothing to the play ticker
 * and carries no state; a missed ping is a missed moment, exactly like a
 * reaction.
 *
 * Solo playtest has no table to tell, so `ping` still lights the ring
 * locally and sends nothing. That is deliberate: the ring is also the
 * feedback that a tap landed, and a goldfish session should not feel like a
 * lesser board.
 */
export function useTablePings(
  mySeat: number | null,
  send: ((cardId: string) => void) | null
): TablePings {
  const onlineSignal = usePlayStore((s) => s.onlineSignal);
  const [pings, setPings] = useState<readonly TablePing[]>([]);
  const nextId = useRef(1);
  const lastSent = useRef(0);

  const add = useCallback((seat: number, targetSeat: number, cardId: string) => {
    const id = nextId.current++;
    setPings((prev) => [...prev, { id, seat, targetSeat, cardId }]);
    // Each ring expires on its own timer rather than a single sweep, so a
    // second ping never cuts the first one's animation short.
    setTimeout(() => setPings((prev) => prev.filter((p) => p.id !== id)), PING_MS);
  }, []);

  const ping = useCallback(
    (cardId: string) => {
      const seat = mySeat ?? 0;
      add(seat, seat, cardId);
      if (!send) return;
      const now = Date.now();
      if (now - lastSent.current < SEND_THROTTLE_MS) return;
      lastSent.current = now;
      send(cardId);
    },
    [add, mySeat, send]
  );

  useEffect(() => {
    const signal = onlineSignal?.signal;
    if (!signal || signal.kind !== 'ping' || !signal.cardId || signal.targetSeat == null) return;
    // Your own ping already rang locally the instant you tapped — echoing
    // the server's copy would double every ring you draw.
    if (mySeat !== null && signal.seat === mySeat) return;
    const { seat, targetSeat, cardId } = signal;
    // Deferred a microtask for the same reason `useTablePointer` defers:
    // this reacts to a store push, and react-hooks/set-state-in-effect
    // forbids the direct call.
    queueMicrotask(() => add(seat, targetSeat, cardId));
    // Keyed on the signal identity so the same card pinged twice rings twice.
  }, [onlineSignal, mySeat, add]);

  return { pings, ping };
}
