import { useDroppable } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { useLongPress } from '@/lib/use-long-press';
import { PlaytestCardView } from './PlaytestCardView';

interface Props {
  cards: BattlefieldCard[];
  /** Ids in the current selection (E226 group copy); empty set = none. */
  selectedIds: ReadonlySet<string>;
  /** Ids currently waiting to resolve — they stay on the battlefield and
   *  wear a ribbon. Empty set = nothing on the stack. */
  stackIds: ReadonlySet<string>;
  /** A click that landed on the battlefield itself, not on a card. */
  onBackgroundClick(): void;
  /** Right-click, or a touch long-press, on bare felt — opens the table
   *  menu. Omitted on tiers that have no table menu. */
  onBackgroundContextMenu?(x: number, y: number): void;
  onCardClick(cardId: string, e: React.MouseEvent | React.KeyboardEvent): void;
  onCardContextMenu(cardId: string, e: React.MouseEvent): void;
  onCardLongPress?(cardId: string, clientX: number, clientY: number): void;
}

export function Battlefield({
  cards,
  selectedIds,
  stackIds,
  onBackgroundClick,
  onBackgroundContextMenu,
  onCardClick,
  onCardContextMenu,
  onCardLongPress,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield' });
  // Touch route to the table menu. Cards run their own long-press first and
  // their touches are not the felt's, so this only ever starts on bare felt.
  const bgPress = useLongPress({
    onLongPress: (x, y) => onBackgroundContextMenu?.(x, y),
  });
  return (
    <div
      ref={setNodeRef}
      className={`playtest-battlefield${isOver ? ' is-over' : ''}`}
      aria-label="Battlefield"
      // Decorative from an interaction standpoint: click-away-to-deselect
      // only duplicates the keyboard-reachable Escape shortcut and the
      // visible "Clear" button in the selection readout (PlaytestBoard.tsx),
      // never the only way to clear a selection.
      role="presentation"
      // Clicking bare felt clears the selection — the standard
      // click-away-to-deselect gesture. Cards stop their own clicks from
      // reaching here by handling them first (React bubbles, so compare the
      // target instead of relying on stopPropagation in every card).
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackgroundClick();
      }}
      onContextMenu={
        onBackgroundContextMenu
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              onBackgroundContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
      onTouchStart={
        onBackgroundContextMenu
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              bgPress.onTouchStart(e);
            }
          : undefined
      }
      onTouchMove={onBackgroundContextMenu ? bgPress.onTouchMove : undefined}
      onTouchEnd={onBackgroundContextMenu ? bgPress.onTouchEnd : undefined}
      onTouchCancel={onBackgroundContextMenu ? bgPress.onTouchCancel : undefined}
    >
      {cards.length === 0 && (
        <p className="playtest-battlefield__empty">Tap or drag a card from your hand to play it</p>
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
          onStack={stackIds.has(bf.card.id)}
          onClick={onCardClick}
          onContextMenu={onCardContextMenu}
          onLongPress={onCardLongPress}
        />
      ))}
    </div>
  );
}
