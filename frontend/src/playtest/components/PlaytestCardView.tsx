import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';

interface Props {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  draggableId: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** When true, positions the card absolutely using bf.x/bf.y. */
  positioned?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PlaytestCardView({
  card,
  bf,
  draggableId,
  onClick,
  onContextMenu,
  positioned = false,
  size = 'md',
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { cardId: card.id },
  });

  const tapped = bf?.tapped ?? false;
  const faceDown = bf?.faceDown ?? false;
  const counters = bf?.counters ?? {};

  const baseTransform = positioned && bf ? `translate(${bf.x}px, ${bf.y}px)` : '';
  const tapTransform = tapped ? ' rotate(90deg)' : '';
  const dragTransform = transform ? CSS.Translate.toString(transform) : '';

  const style: React.CSSProperties = {
    position: positioned ? 'absolute' : 'relative',
    transform: dragTransform || `${baseTransform}${tapTransform}`,
    transformOrigin: 'center center',
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`playtest-card playtest-card--${size}${tapped ? ' playtest-card--tapped' : ''}`}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      aria-label={card.name}
    >
      {faceDown ? (
        <div className="playtest-card__back" aria-label="Face-down card" />
      ) : card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} draggable={false} />
      ) : (
        <div className="playtest-card__placeholder">{card.name}</div>
      )}
      {Object.entries(counters).length > 0 && (
        <div className="playtest-card__counters">
          {Object.entries(counters).map(([k, v]) => (
            <span key={k} className="playtest-card__counter" title={k}>
              {k === '+1/+1' ? '+1' : k.slice(0, 3)}:{v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
