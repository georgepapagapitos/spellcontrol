import { useDroppable } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { PlaytestCardView } from './PlaytestCardView';

interface Props {
  cards: BattlefieldCard[];
  onCardClick(cardId: string): void;
  onCardContextMenu(cardId: string, e: React.MouseEvent): void;
  onCardLongPress?(cardId: string, clientX: number, clientY: number): void;
}

export function Battlefield({ cards, onCardClick, onCardContextMenu, onCardLongPress }: Props) {
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
        // onClick/onContextMenu/onLongPress are passed straight through
        // (no per-card wrapper arrow) so their identity stays stable across
        // renders — required for React.memo(PlaytestCardView) to actually
        // skip re-rendering cards that didn't change.
        <PlaytestCardView
          key={bf.card.id}
          card={bf.card}
          bf={bf}
          draggableId={`bf:${bf.card.id}`}
          positioned
          onClick={onCardClick}
          onContextMenu={onCardContextMenu}
          onLongPress={onCardLongPress}
        />
      ))}
    </div>
  );
}
