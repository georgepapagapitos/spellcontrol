import { useDroppable } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { PlaytestCardView } from './PlaytestCardView';

interface Props {
  cards: BattlefieldCard[];
  /** Ids in the current selection (E226 group copy); empty set = none. */
  selectedIds: ReadonlySet<string>;
  /** A click that landed on the battlefield itself, not on a card. */
  onBackgroundClick(): void;
  onCardClick(cardId: string, e: React.MouseEvent | React.KeyboardEvent): void;
  onCardContextMenu(cardId: string, e: React.MouseEvent): void;
  onCardLongPress?(cardId: string, clientX: number, clientY: number): void;
}

export function Battlefield({
  cards,
  selectedIds,
  onBackgroundClick,
  onCardClick,
  onCardContextMenu,
  onCardLongPress,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield' });
  return (
    <div
      ref={setNodeRef}
      className={`playtest-battlefield${isOver ? ' is-over' : ''}`}
      aria-label="Battlefield"
      // Clicking bare felt clears the selection — the standard
      // click-away-to-deselect gesture. Cards stop their own clicks from
      // reaching here by handling them first (React bubbles, so compare the
      // target instead of relying on stopPropagation in every card).
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackgroundClick();
      }}
    >
      {cards.length === 0 && (
        <p className="playtest-battlefield__empty">
          Tap a card in your hand — or drag it here — to play it
        </p>
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
          selected={selectedIds.has(bf.card.id)}
          onClick={onCardClick}
          onContextMenu={onCardContextMenu}
          onLongPress={onCardLongPress}
        />
      ))}
    </div>
  );
}
