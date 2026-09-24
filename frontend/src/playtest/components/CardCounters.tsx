import { useRef, useState, type CSSProperties } from 'react';
import { useLongPress } from '@/lib/use-long-press';
import { counterColor, counterGlyph, counterLabel, sortCounters } from '../lib/counter-kinds';
import './CardCounters.css';

interface Props {
  counters: Record<string, number>;
  /**
   * `edge` is EDHPlay's layout for a card on the felt: printed counters as
   * icons just off its top-right corner, clear of the art. `inset` keeps them
   * inside the card, for a face drawn with nothing around it (another seat's
   * board, the drag copy, the hover preview).
   */
  placement: 'edge' | 'inset';
  /** Present makes every counter a control: a click adds one, a right-click
   *  or a long press takes one off. */
  onStep?(kind: string, delta: 1 | -1): void;
}

/** How long a "+1" floats above the card before it goes. */
const BURST_MS = 900;
let burstSeq = 0;

/**
 * A card's counters the way EDHPlay draws them. A counter a card prints
 * (+1/+1, charge, flying) is its icon on a black disc with the count in a red
 * bubble; a counter the player named is a coloured disc with the count on it,
 * up the card's left edge. Hovering one names it.
 *
 * Rendered BESIDE the card on the felt, never inside it: the card is a
 * `role="button"`, and a control nested in another control is unreachable.
 */
export function CardCounters({ counters, placement, onStep }: Props) {
  const [bursts, setBursts] = useState<Array<{ id: number; kind: string; delta: 1 | -1 }>>([]);
  const list = sortCounters(counters);
  if (list.length === 0 && bursts.length === 0) return null;

  const step = onStep
    ? (kind: string, delta: 1 | -1) => {
        onStep(kind, delta);
        const id = ++burstSeq;
        setBursts((b) => [...b, { id, kind, delta }]);
        setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), BURST_MS);
      }
    : undefined;

  const badges = (marks: boolean) =>
    list
      .filter(([kind]) => Boolean(counterGlyph(kind)) === marks)
      .map(([kind, n]) => (
        <CounterBadge key={kind} kind={kind} n={n} onStep={step && ((d) => step(kind, d))} />
      ));
  const marks = badges(true);
  const discs = badges(false);

  return (
    <div className={`card-counters card-counters--${placement}`}>
      {marks.length > 0 && <div className="card-counters__marks">{marks}</div>}
      {discs.length > 0 && <div className="card-counters__discs">{discs}</div>}
      {bursts.length > 0 && (
        <div className="card-counters__bursts" aria-hidden>
          {bursts.map((b) => (
            <span key={b.id} className="card-counters__burst">
              {b.delta > 0 ? '+1' : '−1'}
              <CounterFace kind={b.kind} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The disc itself: an icon, or a colour with the count (or nothing, when
 *  the count is shown elsewhere, as in the "+1" that floats up). */
function CounterFace({ kind, n }: { kind: string; n?: number }) {
  const glyph = counterGlyph(kind);
  const count = n !== undefined && (
    <span className="card-counter__n" aria-hidden>
      {n}
    </span>
  );
  return (
    <span
      className={`card-counter ${glyph ? 'card-counter--mark' : 'card-counter--disc'}`}
      style={glyph ? undefined : ({ '--disc': counterColor(kind) } as CSSProperties)}
    >
      {glyph && <i className={`ms ${glyph}`} aria-hidden />}
      {count}
    </span>
  );
}

function CounterBadge({
  kind,
  n,
  onStep,
}: {
  kind: string;
  n: number;
  onStep?(delta: 1 | -1): void;
}) {
  const label = counterLabel(kind);
  // A long press on Android also fires `contextmenu`; the press already took
  // one off, so the menu event that trails it must not take a second.
  const touchedAt = useRef(0);
  const longPress = useLongPress({ onLongPress: () => onStep?.(-1) });

  if (!onStep) {
    return (
      <span className="card-counter-slot" role="img" aria-label={`${label}: ${n}`}>
        <CounterFace kind={kind} n={n} />
      </span>
    );
  }

  return (
    <button
      type="button"
      className="card-counter-slot"
      data-tip={`${label} (${n})`}
      aria-label={`${label}: ${n}. Minus takes one off.`}
      onClick={() => {
        if (!longPress.consumedClick()) onStep(1);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - touchedAt.current > 1000) onStep(-1);
      }}
      onTouchStart={(e) => {
        touchedAt.current = Date.now();
        longPress.onTouchStart(e);
      }}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onKeyDown={(e) => {
        // Enter and Space add one as a click does. These keys are the board's
        // too (− shrinks the cards), so a focused counter keeps them.
        const delta =
          e.key === '-' || e.key === 'ArrowDown' || e.key === 'Delete' || e.key === 'Backspace'
            ? -1
            : e.key === '+' || e.key === '=' || e.key === 'ArrowUp'
              ? 1
              : 0;
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation();
        onStep(delta);
      }}
    >
      <CounterFace kind={kind} n={n} />
    </button>
  );
}
