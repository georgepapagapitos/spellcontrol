import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard, Zone } from '@/lib/playtest';

interface Props {
  zone: Zone;
  label: string;
  cards: PlaytestCard[];
  onClick(): void;
}

export function ZonePile({ zone, label, cards, onClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const top = cards[cards.length - 1];
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={`playtest-pile${isOver ? ' is-over' : ''}`}
      aria-label={`${label} (${cards.length} cards)`}
    >
      <span className="playtest-pile__label">{label}</span>
      <div className="playtest-pile__stack">
        {top && zone !== 'library' && top.imageUrl ? (
          <img src={top.imageUrl} alt={top.name} draggable={false} />
        ) : (
          <div className={`playtest-pile__back playtest-pile__back--${zone}`} />
        )}
      </div>
      <span className="playtest-pile__count">{cards.length}</span>
    </button>
  );
}
