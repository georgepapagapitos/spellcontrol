import { memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
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
  onClick?: (cardId: string) => void;
  onContextMenu?: (cardId: string, e: React.MouseEvent) => void;
  onLongPress?: (cardId: string, clientX: number, clientY: number) => void;
  /** When true, positions the card absolutely using bf.x/bf.y. */
  positioned?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const PlaytestCardView = memo(function PlaytestCardView({
  card,
  bf,
  draggableId,
  onClick,
  onContextMenu,
  onLongPress,
  positioned = false,
  size = 'md',
}: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { cardId: card.id },
  });

  const longPress = useLongPress({
    onLongPress: (x, y) => onLongPress?.(card.id, x, y),
  });

  const tapped = bf?.tapped ?? false;
  const baseTransform = positioned && bf ? `translate(${bf.x}px, ${bf.y}px)` : '';
  const tapTransform = tapped ? ' rotate(90deg)' : '';

  // The drag *transform* is intentionally NOT applied here: the source card
  // stays put (dimmed) while a top-level <DragOverlay> renders the moving
  // copy. Translating the source instead would leave it clipped by the hand
  // strip's / battlefield's `overflow` and stuck behind sibling surfaces.
  const style: React.CSSProperties = {
    position: positioned ? 'absolute' : 'relative',
    transform: `${baseTransform}${tapTransform}` || undefined,
    transformOrigin: 'center center',
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <PlaytestCardFace
      ref={setNodeRef}
      card={card}
      bf={bf}
      size={size}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (onLongPress && longPress.consumedClick()) return;
        onClick?.(card.id);
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(card.id, e) : undefined}
      onTouchStart={onLongPress ? longPress.onTouchStart : undefined}
      onTouchMove={onLongPress ? longPress.onTouchMove : undefined}
      onTouchEnd={onLongPress ? longPress.onTouchEnd : undefined}
      onTouchCancel={onLongPress ? longPress.onTouchCancel : undefined}
      role="button"
      tabIndex={0}
      aria-label={card.name}
    />
  );
});
