import { useDroppable } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { PlaytestCardView } from './PlaytestCardView';

interface Props {
  cards: BattlefieldCard[];
  onCardClick(cardId: string): void;
  onCardContextMenu(cardId: string, e: React.MouseEvent): void;
}

export function Battlefield({ cards, onCardClick, onCardContextMenu }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield' });
  return (
    <div
      ref={setNodeRef}
      className={`playtest-battlefield${isOver ? ' is-over' : ''}`}
      aria-label="Battlefield"
    >
      {cards.length === 0 && (
        <p className="playtest-battlefield__empty">Drag cards here to play them</p>
      )}
      {cards.map((bf) => (
        <PlaytestCardView
          key={bf.card.id}
          card={bf.card}
          bf={bf}
          draggableId={`bf:${bf.card.id}`}
          positioned
          onClick={() => onCardClick(bf.card.id)}
          onContextMenu={(e) => onCardContextMenu(bf.card.id, e)}
        />
      ))}
    </div>
  );
}
