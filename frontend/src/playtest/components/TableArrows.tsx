import { useEffect, useState } from 'react';
import { paletteForIndex } from '@/lib/seat-palette';
import { usePlayStore, type TableArrow } from '@/store/play';
import { opponentPreviewId } from './OpponentQuadrant';
import './TableArrows.css';

/** How often the ends are re-measured while any arrow is on the table. */
const MEASURE_MS = 120;

interface Point {
  x: number;
  y: number;
}

/**
 * Where an arrow end sits on screen: the card if it is rendered anywhere
 * (own board writes the bare id as `data-preview-id`; a quadrant writes the
 * seat-scoped one), else the seat's anchor, else nothing — an end that isn't
 * on screen at this tier hides the arrow rather than pointing at air.
 */
function endOf(seat: number, cardId: string | undefined, mySeat: number): Point | null {
  const sel: string[] = [];
  if (cardId) {
    const id = seat === mySeat ? cardId : opponentPreviewId(seat, cardId);
    sel.push(`[data-preview-id="${CSS.escape(id)}"]`);
  }
  sel.push(`[data-seat-anchor="${seat}"]`);
  for (const s of sel) {
    const el = document.querySelector<HTMLElement>(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}

interface Drawn {
  arrow: TableArrow;
  from: Point;
  to: Point;
}

/**
 * The arrows everyone at the table drew, laid over the whole viewport and
 * re-measured on a short timer while any exist (cards move, boards scroll,
 * sizes change — measuring a handful of rects is cheaper than tracking every
 * cause). Coloured by the seat that drew them; yours a shade brighter.
 */
export function TableArrows({ mySeat }: { mySeat: number }) {
  const arrows = usePlayStore((s) => s.onlineArrows);
  const [drawn, setDrawn] = useState<Drawn[]>([]);

  useEffect(() => {
    // With no arrows the render below is null regardless of `drawn`, so the
    // stale list needs no clearing here (and an effect must not set state).
    if (arrows.length === 0) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const next: Drawn[] = [];
      for (const arrow of arrows) {
        const from = endOf(arrow.fromSeat, arrow.fromCardId, mySeat);
        const to = endOf(arrow.toSeat, arrow.toCardId, mySeat);
        if (from && to) next.push({ arrow, from, to });
      }
      setDrawn(next);
    };
    const tick = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    tick();
    const timer = setInterval(tick, MEASURE_MS);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', tick);
      window.removeEventListener('scroll', tick, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [arrows, mySeat]);

  if (arrows.length === 0 || drawn.length === 0) return null;
  return (
    <svg className="table-arrows" aria-hidden="true" data-count={drawn.length}>
      <defs>
        {drawn.map(({ arrow }) => (
          <marker
            key={arrow.id}
            id={`table-arrow-head-${arrow.id.replace(/[^a-z0-9]/gi, '_')}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={paletteForIndex(arrow.seat).base} />
          </marker>
        ))}
      </defs>
      {drawn.map(({ arrow, from, to }) => {
        // Shorten the tail so the head lands on the card's edge, not its centre.
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const trim = Math.min(len / 2, 36);
        const tx = to.x - (dx / len) * trim;
        const ty = to.y - (dy / len) * trim;
        const head = `table-arrow-head-${arrow.id.replace(/[^a-z0-9]/gi, '_')}`;
        return (
          <g key={arrow.id} className={arrow.seat === mySeat ? 'is-mine' : undefined}>
            <line className="table-arrows__halo" x1={from.x} y1={from.y} x2={tx} y2={ty} />
            <line
              className="table-arrows__line"
              x1={from.x}
              y1={from.y}
              x2={tx}
              y2={ty}
              stroke={paletteForIndex(arrow.seat).base}
              markerEnd={`url(#${head})`}
            />
          </g>
        );
      })}
    </svg>
  );
}
