import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Move, X } from 'lucide-react';
import { ManaCost } from '@/components/ManaCost';
import './StackPanel.css';

export interface StackPanelItem {
  /** Unique per row. Your own rows use the card's own instance id; an
   *  opponent's use the seat-scoped one, so the two can never collide. */
  id: string;
  name: string;
  imageUrl?: string;
  manaCost?: string;
  isToken: boolean;
  /** Seat that put it there — null in solo playtest. */
  seat: number | null;
  seatName?: string;
  /** Only your own rows carry the three actions: you can't resolve somebody
   *  else's spell, at this table or a real one. */
  mine: boolean;
}

interface Props {
  items: readonly StackPanelItem[];
  /** Draw an arrow from the top card — the same arrow `W` draws. */
  onDrawArrow(id: string): void;
  /** Put a token copy of the top card onto the stack above it. */
  onCopy(id: string): void;
  /** Resolve the top card. */
  onResolve(id: string): void;
  /** Key chips printed on the action buttons, so a rebound key never lies. */
  copyKey?: string;
  resolveKey?: string;
  arrowKey?: string;
}

/** Where the panel sits until somebody drags it, as a fraction-free pixel
 *  offset from the top-right — clear of the turn/menu cluster and of the
 *  battlefield's busiest band. */
const DEFAULT_POS = { right: 24, top: 96 };

/**
 * The stack: a floating panel listing every card currently waiting to
 * resolve, bottom of the stack first, with the TOP one opened out to its
 * full face because it is the only one anybody is about to act on.
 *
 * ⚠️ A card on the stack has NOT left the battlefield — it keeps its place
 * and wears a ribbon (`playtest-card--on-stack`). This panel is a view onto
 * those marked cards, which is why every row resolves its art and name from
 * live board state rather than holding a copy of the card.
 *
 * Draggable by its header, because it necessarily covers part of the board
 * and only the player knows which part they need. Closable, because a
 * player who is tracking the stack in their head should be able to put it
 * away — the ribbons on the cards are the durable signal, not this panel.
 *
 * Order is exact WITHIN a seat and grouped ACROSS seats: each client owns
 * its own stack and there is no shared clock to interleave them by, so the
 * panel groups rather than inventing an order it cannot know.
 */
export function StackPanel({
  items,
  onDrawArrow,
  onCopy,
  onResolve,
  copyKey,
  resolveKey,
  arrowKey,
}: Props) {
  const [closed, setClosed] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // A stack that empties and refills is a new stack to look at: reopen the
  // panel rather than leaving a player who closed it once blind for the
  // rest of the game.
  const count = items.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (prevCount.current === 0 && count > 0) setClosed(false);
    prevCount.current = count;
  }, [count]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    // Clamped so the panel can never be dragged off-screen and stranded.
    const left = Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - d.dx));
    const top = Math.max(0, Math.min(window.innerHeight - 44, e.clientY - d.dy));
    setPos({ left, top });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  if (items.length === 0 || closed) return null;

  // The top of the stack is the last thing put there, and the only row that
  // opens out to its full face.
  const top = items[items.length - 1];
  const rest = items.slice(0, -1);

  return (
    <div
      ref={panelRef}
      className="stack-panel"
      style={pos ? { left: pos.left, top: pos.top } : DEFAULT_POS}
      role="region"
      aria-label={`The stack, ${items.length} waiting to resolve`}
    >
      <header className="stack-panel__head">
        <button
          type="button"
          className="stack-panel__grip"
          aria-label="Move the stack panel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Move width={16} height={16} aria-hidden />
        </button>
        <h2 className="stack-panel__title">Stack ({items.length})</h2>
        <button
          type="button"
          className="stack-panel__close"
          aria-label="Hide the stack panel"
          onClick={() => setClosed(true)}
        >
          <X width={16} height={16} aria-hidden />
        </button>
      </header>

      <ol className="stack-panel__list">
        {rest.map((item) => (
          <li key={item.id} className="stack-panel__row">
            <span className="stack-panel__seat">{item.seatName ?? 'A player'}</span>
            <span className="stack-panel__bar">
              <span className="stack-panel__name">{item.name}</span>
              {item.manaCost && (
                <span className="stack-panel__cost" aria-hidden>
                  <ManaCost cost={item.manaCost} />
                </span>
              )}
            </span>
          </li>
        ))}

        <li className="stack-panel__row stack-panel__row--top">
          <span className="stack-panel__seat">{top.seatName ?? 'A player'}</span>
          <span className="stack-panel__bar">
            <span className="stack-panel__name">{top.name}</span>
            {top.manaCost && (
              <span className="stack-panel__cost" aria-hidden>
                <ManaCost cost={top.manaCost} />
              </span>
            )}
          </span>
          {top.imageUrl ? (
            <img
              className="stack-panel__art"
              src={top.imageUrl}
              alt={top.name}
              draggable={false}
              decoding="async"
            />
          ) : (
            <div className="stack-panel__art stack-panel__art--placeholder">{top.name}</div>
          )}
        </li>
      </ol>

      {top.mine && (
        <div className="stack-panel__actions">
          <button
            type="button"
            className="stack-panel__action"
            onClick={() => onDrawArrow(top.id)}
            aria-label={arrowKey ? `Draw arrow (${arrowKey})` : 'Draw arrow'}
            title={arrowKey ? `Draw arrow (${arrowKey})` : 'Draw arrow'}
          >
            <ArrowUpRight width={18} height={18} aria-hidden />
          </button>
          <button
            type="button"
            className="stack-panel__action"
            onClick={() => onCopy(top.id)}
            aria-label={copyKey ? `Create copy (${copyKey})` : 'Create copy'}
            title={copyKey ? `Create copy (${copyKey})` : 'Create copy'}
          >
            <Copy width={18} height={18} aria-hidden />
          </button>
          <button
            type="button"
            className="stack-panel__action stack-panel__action--resolve"
            onClick={() => onResolve(top.id)}
            aria-label={resolveKey ? `Resolve (${resolveKey})` : 'Resolve'}
            title={resolveKey ? `Resolve (${resolveKey})` : 'Resolve'}
          >
            <Check width={18} height={18} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
