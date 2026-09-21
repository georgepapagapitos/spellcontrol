import { memo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { handSlotDroppableId, hostDroppableId } from '../lib/zones';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { useLongPress } from '@/lib/use-long-press';
import { PlaytestCardFace } from './PlaytestCardFace';

interface Props {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  draggableId: string;
  // Id-taking (rather than pre-bound) so a caller rendering many cards (e.g.
  // Battlefield's `.map`) can pass the same stable callback to every card
  // instead of allocating a fresh closure per card per render — that
  // closure-per-card churn is what breaks memo below.
  onClick?: (cardId: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onContextMenu?: (cardId: string, e: React.MouseEvent) => void;
  onLongPress?: (cardId: string, clientX: number, clientY: number) => void;
  /** Native tooltip — the hand uses it to name its two gestures. */
  title?: string;
  /** When true, the card fills its positioned slot on the battlefield (see
   *  `.playtest-card-slot`) and registers as an attachment host. */
  positioned?: boolean;
  /** Suppresses the card's own read-only power/toughness box — the caller is
   *  rendering the editable badges beside it instead. */
  ptHidden?: boolean;
  /** In hand, with arranging on (E348): the card is also a drop target for
   *  its neighbours, so dragging one onto it puts that card in this place.
   *  Registered on the card's own node — the same shape as the battlefield's
   *  host droppable below, and the only one that has a box to measure. */
  handSlot?: boolean;
  /** Part of the current battlefield selection (E226 group copy). A plain
   *  boolean rather than the whole set so `memo` only re-renders the cards
   *  whose own selection actually changed. */
  selected?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Waiting to resolve — see `PlaytestCardFace.onStack`. */
  onStack?: boolean;
}

export const PlaytestCardView = memo(function PlaytestCardView({
  card,
  bf,
  draggableId,
  onClick,
  onContextMenu,
  onLongPress,
  title,
  positioned = false,
  ptHidden = false,
  handSlot = false,
  selected = false,
  size = 'md',
  onStack = false,
}: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { cardId: card.id },
  });
  // A battlefield permanent is also a drop target for an Aura / Equipment
  // dragged onto it (drag-to-attach). PlaytestBoard's collision detection
  // only ever reports a host while an attachment is being dragged, so this
  // is inert for every other drag. Disabled off the battlefield (hand cards
  // aren't hosts) — the hook must still be called unconditionally.
  const host = useDroppable({ id: hostDroppableId(card.id), disabled: !positioned });
  const slot = useDroppable({ id: handSlotDroppableId(card.id), disabled: !handSlot });

  const longPress = useLongPress({
    onLongPress: (x, y) => onLongPress?.(card.id, x, y),
  });

  const tapped = bf?.tapped ?? false;

  // Position lives on the slot around the card (`.playtest-card-slot`, which
  // reads the same 0..1 x/y fractions); the card just fills it. The tap
  // rotation stays a `transform` — the drag *transform* is intentionally NOT
  // applied here:
  // the source card stays put (dimmed) while a top-level <DragOverlay>
  // renders the moving copy. Translating the source instead would leave it
  // clipped by the hand strip's / battlefield's `overflow` and stuck behind
  // sibling surfaces.
  const style: React.CSSProperties = {
    position: 'relative',
    transform: tapped ? 'rotate(90deg)' : undefined,
    transformOrigin: 'center center',
    opacity: isDragging ? 0.4 : 1,
  };

  const activate = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (onLongPress && longPress.consumedClick()) return;
    onClick?.(card.id, e);
  };

  return (
    <PlaytestCardFace
      ref={(el) => {
        setNodeRef(el);
        host.setNodeRef(el);
        slot.setNodeRef(el);
      }}
      card={card}
      bf={bf}
      size={size}
      ptHidden={ptHidden}
      onStack={onStack}
      style={style}
      {...attributes}
      {...listeners}
      className={
        [
          selected && 'playtest-card--selected',
          host.isOver && 'is-attach-target',
          slot.isOver && 'is-hand-drop',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      onClick={activate}
      onKeyDown={(e) => {
        // Keyboard route to the context menu (counters/stickers/move/attach) —
        // previously reachable only by right-click or long-press, with no
        // keyboard path at all. The physical Context Menu key, or Shift+Enter
        // as the discoverable fallback on keyboards without one. Routed through
        // `onLongPress` rather than `onContextMenu` because it already takes
        // plain (id, x, y) coordinates and lands on the same handler, so there's
        // no synthetic MouseEvent to fabricate. Anchored to the card's own box,
        // since a keyboard has no cursor to open at.
        if (onLongPress && (e.key === 'ContextMenu' || (e.key === 'Enter' && e.shiftKey))) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onLongPress(card.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
          return;
        }
        // Same activation as a click — overrides dnd-kit's own keyboard-sensor
        // onKeyDown (an undiscoverable, arrow-key drag with no visual
        // affordance) with the far more useful "tap/play this card" a11y path.
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate(e);
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(card.id, e) : undefined}
      title={title}
      onTouchStart={onLongPress ? longPress.onTouchStart : undefined}
      onTouchMove={onLongPress ? longPress.onTouchMove : undefined}
      onTouchEnd={onLongPress ? longPress.onTouchEnd : undefined}
      onTouchCancel={onLongPress ? longPress.onTouchCancel : undefined}
      role="button"
      tabIndex={0}
      aria-label={[
        card.name,
        card.isToken && !bf?.faceDown && 'token',
        bf?.phased && 'phased out',
        onStack && 'on the stack',
      ]
        .filter(Boolean)
        .join(', ')}
      aria-pressed={selected || undefined}
    />
  );
});
