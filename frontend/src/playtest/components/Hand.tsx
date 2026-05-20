import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { PlaytestCardView } from './PlaytestCardView';

interface Props {
  cards: PlaytestCard[];
  onCardClick?(cardId: string, index: number): void;
}

export function Hand({ cards, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hand' });
  return (
    <div ref={setNodeRef} className={`playtest-hand${isOver ? ' is-over' : ''}`} aria-label="Hand">
      <span className="playtest-hand__label">Hand ({cards.length})</span>
      <div className="playtest-hand__cards">
        {cards.map((c, i) => (
          <PlaytestCardView
            key={c.id}
            card={c}
            draggableId={`hand:${c.id}`}
            size="sm"
            onClick={onCardClick ? () => onCardClick(c.id, i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
