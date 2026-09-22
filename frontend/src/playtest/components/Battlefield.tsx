import { useCallback, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { useLongPress } from '@/lib/use-long-press';
import { PlaytestCardView } from './PlaytestCardView';
import { CardPtBadges } from './CardPtBadges';

interface Props {
  cards: BattlefieldCard[];
  /** Ids in the current selection (E226 group copy); empty set = none. */
  selectedIds: ReadonlySet<string>;
  /** Mid-drag only: the permanents riding along with the card under the
   *  pointer, which the felt translates itself — dnd-kit moves the grabbed
   *  card's <DragOverlay> copy and nothing else. Omitted the rest of the
   *  time, and when a drag moves a single card. */
  ridingIds?: ReadonlySet<string>;
  /** Ids currently waiting to resolve — they stay on the battlefield and
   *  wear a ribbon. Empty set = nothing on the stack. */
  stackIds: ReadonlySet<string>;
  /** A click that landed on the battlefield itself, not on a card. */
  onBackgroundClick(): void;
  /** A drag across bare felt boxed these cards in. `additive` is true when a
   *  modifier was held as the drag started, so the box adds to the selection
   *  instead of replacing it. Omitted disables the gesture. */
  onMarqueeSelect?(ids: string[], additive: boolean): void;
  /** Right-click, or a touch long-press, on bare felt — opens the table
   *  menu. Omitted on tiers that have no table menu. */
  onBackgroundContextMenu?(x: number, y: number): void;
  onCardClick(cardId: string, e: React.MouseEvent | React.KeyboardEvent): void;
  onCardContextMenu(cardId: string, e: React.MouseEvent): void;
  onCardLongPress?(cardId: string, clientX: number, clientY: number): void;
  /** Steps one permanent's power/toughness modifier — what the editable
   *  badges on the card write. Omitted renders them read-only. */
  onAdjustPT?(cardId: string, power: number, toughness: number): void;
}

export function Battlefield({
  cards,
  selectedIds,
  ridingIds,
  stackIds,
  onBackgroundClick,
  onMarqueeSelect,
  onBackgroundContextMenu,
  onCardClick,
  onCardContextMenu,
  onCardLongPress,
  onAdjustPT,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield' });
  // Drag a box across bare felt to select what it touches (EDHPlay's
  // gesture). Pointer state lives in a ref — only the drawn box is state, so
  // a drag re-renders the overlay and not every card on the board.
  const drag = useRef<{ x: number; y: number; additive: boolean; moved: boolean } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // A box that only brushed a card still takes it: at EDHPlay you sweep
  // across a row of lands, you do not trace a rectangle around each one.
  const finishMarquee = useCallback(
    (felt: HTMLElement, x: number, y: number, additive: boolean) => {
      const start = drag.current;
      if (!start) return;
      const left = Math.min(start.x, x);
      const right = Math.max(start.x, x);
      const top = Math.min(start.y, y);
      const bottom = Math.max(start.y, y);
      const ids: string[] = [];
      for (const el of felt.querySelectorAll<HTMLElement>('[data-bf-card]')) {
        const r = el.getBoundingClientRect();
        const id = el.dataset.bfCard;
        if (id && r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom)
          ids.push(id);
      }
      onMarqueeSelect?.(ids, additive);
    },
    [onMarqueeSelect]
  );
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
      // Decorative from an interaction standpoint: neither gesture the felt
      // carries is the only way to reach what it does — Escape clears a
      // selection from the keyboard, and the card menu (right-click, or
      // long-press on touch) acts on one without a box ever being drawn.
      role="presentation"
      // Clicking bare felt clears the selection — the standard
      // click-away-to-deselect gesture. Cards stop their own clicks from
      // reaching here by handling them first (React bubbles, so compare the
      // target instead of relying on stopPropagation in every card).
      onClick={(e) => {
        // A finished box is not a click-away: it just built the selection the
        // click would otherwise throw away.
        if (drag.current?.moved) {
          drag.current = null;
          return;
        }
        drag.current = null;
        if (e.target === e.currentTarget) onBackgroundClick();
      }}
      onPointerDown={
        onMarqueeSelect
          ? (e) => {
              // Bare felt, primary button, and not a finger: a touch drag on
              // the felt is a scroll or the long-press that opens the table
              // menu, and touch builds a selection through select mode.
              if (e.target !== e.currentTarget || e.button !== 0 || e.pointerType === 'touch')
                return;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                additive: e.shiftKey || e.metaKey || e.ctrlKey,
                moved: false,
              };
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }
          : undefined
      }
      onPointerMove={
        onMarqueeSelect
          ? (e) => {
              const start = drag.current;
              if (!start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              // A few pixels of tremor while clicking bare felt is still a
              // click, not a one-pixel box.
              if (!start.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
              start.moved = true;
              const felt = e.currentTarget.getBoundingClientRect();
              setBox({
                x: Math.min(start.x, e.clientX) - felt.left,
                y: Math.min(start.y, e.clientY) - felt.top,
                w: Math.abs(dx),
                h: Math.abs(dy),
              });
            }
          : undefined
      }
      onPointerUp={
        onMarqueeSelect
          ? (e) => {
              setBox(null);
              if (drag.current?.moved)
                finishMarquee(e.currentTarget, e.clientX, e.clientY, drag.current.additive);
              // `drag` is cleared by the click that follows, which reads
              // `moved` to know the selection it must not wipe.
            }
          : undefined
      }
      onPointerCancel={
        onMarqueeSelect
          ? () => {
              drag.current = null;
              setBox(null);
            }
          : undefined
      }
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
      {box && (
        <div
          className="playtest-marquee"
          aria-hidden="true"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      {cards.map((bf) => (
        // One card-sized slot per permanent: it owns the position, and the
        // card and its power/toughness badges sit inside it as siblings. The
        // badges cannot live inside the card — that card is itself a
        // `role="button"`, and a control nested in a control is unreachable.
        <div
          key={bf.card.id}
          className={`playtest-card-slot${ridingIds?.has(bf.card.id) ? ' is-riding' : ''}`}
          // What the marquee hit-tests against: the slot is the card's box on
          // the felt, and it is here rather than on the card so a tapped
          // (rotated) permanent still measures as what the eye sees.
          data-bf-card={bf.card.id}
          style={{ '--pt-x': bf.x, '--pt-y': bf.y } as React.CSSProperties}
        >
          {/* onClick/onContextMenu/onLongPress are passed straight through
              (no per-card wrapper arrow) so their identity stays stable across
              renders — required for React.memo(PlaytestCardView) to actually
              skip re-rendering cards that didn't change. */}
          <PlaytestCardView
            card={bf.card}
            bf={bf}
            draggableId={`bf:${bf.card.id}`}
            positioned
            ptHidden={Boolean(onAdjustPT)}
            selected={selectedIds.has(bf.card.id)}
            onStack={stackIds.has(bf.card.id)}
            onClick={onCardClick}
            onContextMenu={onCardContextMenu}
            onLongPress={onCardLongPress}
          />
          {onAdjustPT && (
            <CardPtBadges
              card={bf.card}
              bf={bf}
              onAdjustPT={(power, toughness) => onAdjustPT(bf.card.id, power, toughness)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
