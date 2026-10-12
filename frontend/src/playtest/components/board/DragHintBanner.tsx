import { useCallback, useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import { WedgeHintStrip } from '@/components/deck/WedgeHintStrip';
import { dismissPlaytestDragHint, shouldShowPlaytestDragHint } from '@/lib/home/wedge-hints';
import { useMediaQuery } from '@/lib/util/use-media-query';

interface DragHintBannerProps {
  handCount: number;
  battlefieldCount: number;
  /** The opening-hand takeover is up (or the table is waiting on its seats):
   *  the exact complement of when the hint may show, so the two never fight
   *  for the same hand. */
  isChoosingHand: boolean;
}

/**
 * Drag-to-play discovery hint (E484, see lib/home/wedge-hints.ts) — dismissed
 * locally too, same reasoning as the binder hint in CardSearchPanel: the
 * strip disappears on click without waiting on a re-render, and
 * dismissPlaytestDragHint()'s localStorage write makes "never again" durable.
 */
export function DragHintBanner({
  handCount,
  battlefieldCount,
  isChoosingHand,
}: DragHintBannerProps) {
  const [dragHintDismissed, setDragHintDismissed] = useState(false);
  const retireDragHint = useCallback(() => {
    setDragHintDismissed(true);
    dismissPlaytestDragHint();
  }, []);

  // Retires the drag-to-play hint the first time a card actually leaves the
  // hand for the battlefield, however it got there (drag, or the hand card
  // menu's Play / Play tapped / Play face down). Hand length falling while
  // battlefield length rises in the same update is that move; nothing else
  // produces that pair (a discard/exile/library move drops the hand alone, a
  // token or a command-zone cast raises the battlefield alone, and a takeback
  // moves both the other way). Cheaper and less invasive than threading a
  // "this came from hand" flag through every MOVE_TO_BATTLEFIELD call site.
  const dragHintCounts = useRef({ hand: handCount, bf: battlefieldCount });
  useEffect(() => {
    const prev = dragHintCounts.current;
    if (!isChoosingHand && handCount < prev.hand && battlefieldCount > prev.bf) retireDragHint();
    dragHintCounts.current = { hand: handCount, bf: battlefieldCount };
  }, [handCount, battlefieldCount, isChoosingHand, retireDragHint]);

  const dragHintCoarsePointer = useMediaQuery('(pointer: coarse)');
  const showDragHint =
    !isChoosingHand && !dragHintDismissed && shouldShowPlaytestDragHint(handCount > 0);
  if (!showDragHint) return null;
  return (
    <WedgeHintStrip
      icon={<Move width={16} height={16} aria-hidden />}
      headline="Play a card"
      detail={
        dragHintCoarsePointer
          ? 'Drag a card onto the battlefield, or hold it for the menu.'
          : 'Drag a card onto the battlefield, or right-click it for the menu.'
      }
      onDismiss={retireDragHint}
    />
  );
}
