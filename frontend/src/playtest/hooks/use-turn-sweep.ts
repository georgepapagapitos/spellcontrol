import { useEffect, useRef, useState } from 'react';

/** Turn-sweep highlight duration — the "somebody else just took the turn"
 *  moment. (The stronger "Your turn" beat for the local seat lives in
 *  `TableMoments.tsx`; a seat never sweeps for its own turn here.) */
export const SWEEP_MS = 600;

/**
 * The seat whose turn just began, for `SWEEP_MS`, or null.
 *
 * Edge-triggered off `activeSeat` CHANGING — never on mount, never re-firing
 * while it holds the same value — mirroring PlaytestBoard's
 * `tableDefeatedTurn` transition guard. Shared by the opponent rail (below
 * 1024px) and the desktop seat grid (at 1024px and up) so the two surfaces
 * flash the same moment on the same clock.
 */
export function useTurnSweep(activeSeat: number | undefined): number | null {
  const [sweepSeat, setSweepSeat] = useState<number | null>(null);
  const prevActiveSeatRef = useRef(activeSeat);

  useEffect(() => {
    const prev = prevActiveSeatRef.current;
    prevActiveSeatRef.current = activeSeat;
    if (activeSeat === undefined || activeSeat === prev) return;
    setSweepSeat(activeSeat);
    const t = setTimeout(() => setSweepSeat(null), SWEEP_MS);
    return () => clearTimeout(t);
  }, [activeSeat]);

  return sweepSeat;
}
