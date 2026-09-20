import { useEffect, useState } from 'react';
import { paletteForIndex } from '@/lib/seat-palette';
import type { TablePing } from '../hooks/use-table-pings';
import { opponentPreviewId } from './OpponentQuadrant';
import './TablePings.css';

interface Placed {
  ping: TablePing;
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * Where the pinged card is on screen, or null when it isn't rendered at
 * this tier. Own cards publish the bare instance id as `data-card-id`; an
 * opponent's quadrant publishes the seat-scoped one — the same two-spelling
 * lookup `TableArrows` does for arrow ends.
 */
function rectOf(ping: TablePing, mySeat: number | null): Placed['rect'] | null {
  const id =
    mySeat !== null && ping.targetSeat !== mySeat
      ? opponentPreviewId(ping.targetSeat, ping.cardId)
      : ping.cardId;
  const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Rings radiating off whichever cards are being pinged right now, laid over
 * the whole viewport and coloured by the seat that pinged.
 *
 * Measured once per ping rather than on a timer (unlike `TableArrows`): a
 * ring lives about a second, and a card that moves inside that second is a
 * card the player is dragging — the ring chasing it would read as a bug,
 * where a ring left on the spot reads as "it was here".
 */
export function TablePings({
  pings,
  mySeat,
}: {
  pings: readonly TablePing[];
  mySeat: number | null;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    if (pings.length === 0) return;
    const raf = requestAnimationFrame(() => {
      const next: Placed[] = [];
      for (const ping of pings) {
        const rect = rectOf(ping, mySeat);
        if (rect) next.push({ ping, rect });
      }
      setPlaced(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [pings, mySeat]);

  // Filtered against the live pings rather than cleared in the effect: a
  // ring whose ping has already expired must not survive into the frame
  // before the next measurement lands, and filtering at render time says
  // that without a second state write.
  const live = placed.filter((p) => pings.some((x) => x.id === p.ping.id));
  if (live.length === 0) return null;
  return (
    <div className="table-pings" aria-hidden="true">
      {live.map(({ ping, rect }) => {
        const palette = paletteForIndex(ping.seat);
        return (
          <span
            key={ping.id}
            className="table-ping"
            style={
              {
                left: `${rect.left + rect.width / 2}px`,
                top: `${rect.top + rect.height / 2}px`,
                // The ring starts flush with the card's longest edge and
                // grows out from there, so it reads as coming OFF the card
                // rather than as a decoration sitting on it.
                '--ping-size': `${Math.max(rect.width, rect.height)}px`,
                '--ping-color': palette.edge,
              } as React.CSSProperties
            }
          >
            <span className="table-ping__ring" />
            <span className="table-ping__ring table-ping__ring--delayed" />
          </span>
        );
      })}
    </div>
  );
}
