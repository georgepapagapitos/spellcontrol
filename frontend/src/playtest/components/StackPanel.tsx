import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Move, X } from 'lucide-react';
import { ManaCost } from '@/components/ManaCost';
import './StackPanel.css';
import { IconButton } from '@/components/shared/Button';

export interface StackPanelItem {
  /** Unique per row. Your own rows use the card's own instance id; an
   *  opponent's use the seat-scoped one, so the two can never collide.
   *  Either way it is the id `CardHoverPreview` resolves art from, which is
   *  what lets a row on this panel raise the same preview the board does. */
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
 * One entry in the pile, rendered from the card's real face. The ones
 * underneath are clipped to the printed title bar, so what you read is the
 * card's own name and mana cost over its own frame colour and the pile
 * looks like cardboard tucked under cardboard rather than a list.
 *
 * A clipped card carries `data-preview-id`, which is all the delegated
 * `CardHoverPreview` needs to raise the full face on hover — the same
 * preview resting on the card itself gives you. The top card is already
 * open to its full face, so it does not ask for one.
 */
function StackCard({ item, clipped }: { item: StackPanelItem; clipped?: boolean }) {
  const art = item.imageUrl;
  return (
    <div
      className={`stack-panel__card${clipped && art ? ' stack-panel__card--clipped' : ''}`}
      data-preview-id={clipped && art ? item.id : undefined}
      data-token={item.isToken ? '' : undefined}
    >
      {art ? (
        <img
          className="stack-panel__face"
          src={art}
          alt={item.name}
          draggable={false}
          decoding="async"
        />
      ) : (
        <div className="stack-panel__bar">
          <span className="stack-panel__name">{item.name}</span>
          {item.manaCost && (
            <span className="stack-panel__cost" aria-hidden>
              <ManaCost cost={item.manaCost} />
            </span>
          )}
        </div>
      )}
      <span className="stack-panel__seat">{item.seatName ?? 'A player'}</span>
      {/* A token copy on the stack is a picture of the card it copied, so the
          row says which it is. A chip rather than the card's corner ribbon:
          the rows underneath are clipped to the title bar, which would cut a
          ribbon in half, and a chip is this panel's own vocabulary. */}
      {item.isToken && <span className="stack-panel__token">Token</span>}
    </div>
  );
}

/**
 * The stack: a floating panel showing every card waiting to resolve as a
 * physical pile, bottom of the stack first, with the TOP one opened out to
 * its full face because it is the only one anybody is about to act on.
 *
 * ⚠️ A card on the stack has NOT left the battlefield — it keeps its place
 * and wears a ribbon (`playtest-card--on-stack`). This panel is a view onto
 * those marked cards, which is why every row resolves its art and name from
 * live board state rather than holding a copy of the card.
 *
 * Draggable by the whole header, because it necessarily covers part of the
 * board and only the player knows which part they need. Closable, because a
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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // The close button sits in the header too, and pressing it is not a
    // drag. Anywhere else in the bar is.
    if ((e.target as Element).closest?.('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
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
      <header
        className="stack-panel__head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="stack-panel__grip" aria-hidden>
          <Move width={16} height={16} />
        </span>
        <h2 className="stack-panel__title">Stack ({items.length})</h2>
        <IconButton
          className="stack-panel__close"
          onClick={() => setClosed(true)}
          label="Hide the stack panel"
          icon={<X width={16} height={16} />}
        />
      </header>

      <ol className="stack-panel__list">
        {rest.map((item) => (
          <li key={item.id} className="stack-panel__row">
            <StackCard item={item} clipped />
          </li>
        ))}

        <li className="stack-panel__row stack-panel__row--top">
          <StackCard item={top} />
        </li>
      </ol>

      {top.mine && (
        <div className="stack-panel__actions">
          <IconButton
            className="stack-panel__action"
            onClick={() => onDrawArrow(top.id)}
            label={arrowKey ? `Draw arrow (${arrowKey})` : 'Draw arrow'}
            icon={<ArrowUpRight width={18} height={18} />}
          />
          <IconButton
            className="stack-panel__action"
            onClick={() => onCopy(top.id)}
            label={copyKey ? `Create copy (${copyKey})` : 'Create copy'}
            icon={<Copy width={18} height={18} />}
          />
          <IconButton
            className="stack-panel__action stack-panel__action--resolve"
            onClick={() => onResolve(top.id)}
            label={resolveKey ? `Resolve (${resolveKey})` : 'Resolve'}
            icon={<Check width={18} height={18} />}
          />
        </div>
      )}
    </div>
  );
}
