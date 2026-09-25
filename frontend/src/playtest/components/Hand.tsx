import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { ManaCost } from '@/components/ManaCost';
import { fanCardWidth, fanOverlap, fanTilt } from '../lib/fan-layout';
import { isPlaytestLand } from '../lib/zones';
import { PlaytestCardView } from './PlaytestCardView';

/** Desktop density fallback, before the fan has measured `--pt-card-w`. */
const FALLBACK_CARD_W = 100;

interface Props {
  cards: PlaytestCard[];
  /**
   * Table tier (≥1024px): the hand is an overlapping, rotated fan floating
   * over the battlefield, rather than the flat scrolling strip the hand
   * sheet keeps. Its count and menu live beside the library (the board's
   * Hand button), not here.
   */
  fan?: boolean;
  /** Open the hand-card menu (HandCardMenu.tsx) — right-click, the Context
   *  Menu key / Shift+Enter, a touch long-press, or Enter on the card.
   *  Nothing on a hand card plays it by itself: a mouse click does nothing
   *  (EDHPlay's rule — you drag it, press A, or pick Move to ▸ Battlefield),
   *  and a keyboard, which has no drag, gets the menu, where playing it is
   *  one more key. */
  onCardMenu?(cardId: string, x: number, y: number): void;
  /** A tap from a finger or a pen: show the card at reading size, the one
   *  thing a mouse gets by resting on it (EDHPlay's phone table; user,
   *  2026-09-25). The menu stays on the long-press. Without this, a tap
   *  opens the menu as Enter does. */
  onCardPreview?(cardId: string, x: number, y: number): void;
  /** Cards currently being shown to the table (R). Marked in place rather
   *  than moved: it is still in your hand, everyone can just see it. */
  revealedIds?: ReadonlySet<string>;
  /** Arranging the hand is on (E348): every card also becomes a drop target,
   *  so dragging one onto another puts it in that place. The board owns the
   *  drop itself — this only registers the targets. */
  reorderable?: boolean;
}

/**
 * The fan's per-card placement. Rotation and the arc live on the SLOT
 * wrapper, never on the card: the card keeps its own transform free for the
 * hover/focus lift, and dnd-kit's source card is never transformed at all
 * (the moving copy is a top-level `<DragOverlay>`), so dragging composes with
 * the fan by construction.
 */
function fanStyle(i: number, n: number, overlap: number): React.CSSProperties {
  const { deg, drop } = fanTilt(i, n);
  return {
    transform: `rotate(${deg.toFixed(2)}deg) translateY(${drop.toFixed(1)}px)`,
    marginLeft: i === 0 ? undefined : `calc(var(--pt-card-w) * ${(-overlap).toFixed(3)})`,
    zIndex: i,
  };
}

/**
 * The width the fan actually has: its CONTAINER (the battlefield wrap), not
 * the viewport. They were the same thing until the desktop seat grid gave the
 * wrap half the screen — a viewport-wide fan then reached across into the
 * neighbouring seat's board and under your own pile row. Observed rather than
 * listened for on `resize`, so a layout change that isn't a window resize
 * (the rail giving way to the grid) re-spreads too.
 */
function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function Hand({
  cards,
  fan = false,
  onCardMenu,
  onCardPreview,
  revealedIds,
  reorderable = false,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hand' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerW = useContainerWidth(rootRef);
  const [cardW, setCardW] = useState(FALLBACK_CARD_W);
  const [piles, setPiles] = useState<number | undefined>(undefined);

  // `--pt-card-w` is a registered `@property`, so this reads back a resolved px
  // length rather than the `clamp()` text (the same contract PlaytestBoard's
  // drop math relies on). Re-read on resize: the density is viewport-derived.
  // It is the HAND's card size, which a phone sets larger than the table's.
  // `--pt-pile-span` (registered too) is the pile row's width wherever the
  // stylesheet lays that row out itself; 0 at the desk, where the fan
  // derives it.
  useLayoutEffect(() => {
    if (!fan) return;
    const el = rootRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.getPropertyValue('--pt-card-w'));
    if (w > 0) setCardW(w);
    const span = parseFloat(cs.getPropertyValue('--pt-pile-span'));
    setPiles(span > 0 ? span : undefined);
  }, [fan, containerW]);

  const handW = fanCardWidth(cards.length, cardW, containerW, piles);
  const overlap = fanOverlap(cards.length, cardW, containerW, handW, piles);
  // A big hand draws its cards smaller (see `fanCardWidth`). Both sizes are
  // set because each is a registered, inherited length: overriding the width
  // alone would leave every card the full table height.
  const shrunk = fan && handW < cardW;
  const handSize = shrunk
    ? ({
        '--pt-card-w': `${handW.toFixed(1)}px`,
        '--pt-card-h': `${(handW * 1.4).toFixed(1)}px`,
      } as React.CSSProperties)
    : undefined;

  const renderCard = (c: PlaytestCard) => (
    <PlaytestCardView
      key={c.id}
      card={c}
      draggableId={`hand:${c.id}`}
      handSlot={reorderable}
      size="sm"
      onClick={
        onCardMenu
          ? (cardId, e) => {
              // A click from an actual mouse does nothing. A finger or a pen
              // previews the card; Enter opens the menu at the card.
              const pointer = (e.nativeEvent as PointerEvent).pointerType;
              if (pointer === 'mouse') return;
              const r = e.currentTarget.getBoundingClientRect();
              const open =
                onCardPreview && (pointer === 'touch' || pointer === 'pen')
                  ? onCardPreview
                  : onCardMenu;
              open(cardId, r.left + r.width / 2, r.top + r.height / 2);
            }
          : undefined
      }
      onContextMenu={
        onCardMenu
          ? (cardId, e) => {
              e.preventDefault();
              onCardMenu(cardId, e.clientX, e.clientY);
            }
          : undefined
      }
      onLongPress={onCardMenu}
      title={
        onCardMenu
          ? `Drag to play${reorderable ? ' · drag onto another card to arrange' : ''} · right-click or hold for options`
          : undefined
      }
    />
  );

  const revealedBadge = (c: PlaytestCard) =>
    revealedIds?.has(c.id) ? (
      // Not `aria-hidden`: whether the table can see a card in your hand is
      // real game state, and the only place it is stated.
      <span className="playtest-hand__revealed" title="The table can see this">
        Shown
      </span>
    ) : null;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        setNodeRef(el);
      }}
      className={`playtest-hand${fan ? ' playtest-hand--fan' : ''}${isOver ? ' is-over' : ''}`}
      // The tuck below the table edge follows the hand's card height. Not
      // `--pt-card-*` itself: the root reads the table's size back off its
      // own style (above) and places itself by the pile row's width.
      style={
        shrunk
          ? ({ '--pt-hand-card-h': `${(handW * 1.4).toFixed(1)}px` } as React.CSSProperties)
          : undefined
      }
      aria-label="Hand"
    >
      {!fan && <span className="playtest-hand__label">Hand ({cards.length})</span>}
      <div className="playtest-hand__cards" style={handSize}>
        {cards.map((c, i) =>
          fan ? (
            <div
              key={c.id}
              className="playtest-hand__slot"
              style={fanStyle(i, cards.length, overlap)}
            >
              {/* The lift on hover/focus is on this wrapper, so the cost badge
                  rises with its card instead of staying behind on the felt. */}
              <div className="playtest-hand__lift">
                {renderCard(c)}
                {revealedBadge(c)}
                {/* A land has no cost worth reading and a token has no mana
                    value at all, so neither gets a badge. */}
                {c.manaValue !== undefined && !isPlaytestLand(c.typeLine) && (
                  <span
                    className={`playtest-hand__mv${c.manaCost ? '' : ' playtest-hand__mv--plain'}`}
                    aria-hidden
                  >
                    {c.manaCost ? <ManaCost cost={c.manaCost} /> : c.manaValue}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div key={c.id} className="playtest-hand__flat">
              {renderCard(c)}
              {revealedBadge(c)}
            </div>
          )
        )}
      </div>
    </div>
  );
}
