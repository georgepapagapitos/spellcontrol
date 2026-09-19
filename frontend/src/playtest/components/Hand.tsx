import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { ManaCost } from '@/components/ManaCost';
import { fanOverlap } from '../lib/fan-layout';
import { isPlaytestLand } from '../lib/zones';
import { PlaytestCardView } from './PlaytestCardView';

/** Per-viewer convenience only — never read back by anything but this fan. */
const COLLAPSED_KEY = 'spellcontrol:playtest:hand-collapsed';
/** Degrees of rotation per card away from the fan's centre. */
const FAN_STEP_DEG = 2;
/** Pixels a card drops per squared step from centre, which is what arcs the fan. */
const FAN_ARC_PX = 1.2;
/** Desktop density fallback, before the fan has measured `--pt-card-w`. */
const FALLBACK_CARD_W = 100;

interface Props {
  cards: PlaytestCard[];
  /**
   * Table tier (≥1024px): the hand is an overlapping, rotated fan floating
   * over the battlefield with its own collapse toggle, rather than the flat
   * scrolling strip every narrow tier keeps.
   */
  fan?: boolean;
  onCardClick?(cardId: string, index: number): void;
  /** Open the hand-card menu (HandCardMenu.tsx) — right-click, the Context
   *  Menu key / Shift+Enter, or a touch long-press, mirroring how battlefield
   *  cards open theirs. Tap/click still plays the card. */
  onCardMenu?(cardId: string, x: number, y: number): void;
}

/**
 * The fan's per-card placement. Rotation and the arc live on the SLOT
 * wrapper, never on the card: the card keeps its own transform free for the
 * hover/focus lift, and dnd-kit's source card is never transformed at all
 * (the moving copy is a top-level `<DragOverlay>`), so dragging composes with
 * the fan by construction.
 */
function fanStyle(i: number, n: number, overlap: number): React.CSSProperties {
  const off = i - (n - 1) / 2;
  const arc = (off * off * FAN_ARC_PX).toFixed(1);
  return {
    transform: `rotate(${(off * FAN_STEP_DEG).toFixed(2)}deg) translateY(${arc}px)`,
    marginLeft: i === 0 ? undefined : `calc(var(--pt-card-w) * ${(-overlap).toFixed(3)})`,
    zIndex: i,
  };
}

/** Viewport width, tracked so the fan re-spreads when the window resizes. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function Hand({ cards, fan = false, onCardClick, onCardMenu }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hand' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportW = useViewportWidth();
  const [cardW, setCardW] = useState(FALLBACK_CARD_W);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Collapsing is the fan's own affordance; the flat strip has no toggle, so a
  // stored "collapsed" must never hide a narrow viewport's whole hand.
  const isCollapsed = fan && collapsed;

  // `--pt-card-w` is a registered `@property`, so this reads back a resolved px
  // length rather than the `clamp()` text (the same contract PlaytestBoard's
  // drop math relies on). Re-read on resize: the density is viewport-derived.
  useLayoutEffect(() => {
    if (!fan) return;
    const el = rootRef.current;
    if (!el) return;
    const w = parseFloat(getComputedStyle(el).getPropertyValue('--pt-card-w'));
    if (w > 0) setCardW(w);
  }, [fan, viewportW]);

  const overlap = fanOverlap(cards.length, cardW, viewportW);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Private mode / blocked site data: the toggle still works this session.
      }
      return next;
    });
  }

  const renderCard = (c: PlaytestCard, i: number) => (
    <PlaytestCardView
      key={c.id}
      card={c}
      draggableId={`hand:${c.id}`}
      size="sm"
      onClick={onCardClick ? (cardId) => onCardClick(cardId, i) : undefined}
      onContextMenu={
        onCardMenu
          ? (cardId, e) => {
              e.preventDefault();
              onCardMenu(cardId, e.clientX, e.clientY);
            }
          : undefined
      }
      onLongPress={onCardMenu}
      title={onCardMenu ? 'Click to play · right-click or hold for options' : undefined}
    />
  );

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        setNodeRef(el);
      }}
      className={`playtest-hand${fan ? ' playtest-hand--fan' : ''}${
        isCollapsed ? ' is-collapsed' : ''
      }${isOver ? ' is-over' : ''}`}
      aria-label="Hand"
    >
      {!fan && <span className="playtest-hand__label">Hand ({cards.length})</span>}
      {!isCollapsed && (
        <div className="playtest-hand__cards">
          {cards.map((c, i) =>
            fan ? (
              <div
                key={c.id}
                className="playtest-hand__slot"
                style={fanStyle(i, cards.length, overlap)}
              >
                {renderCard(c, i)}
                {/* A land has no cost worth reading and a token has no mana
                    value at all, so neither gets a badge. */}
                {c.manaValue !== undefined && !isPlaytestLand(c.typeLine) && (
                  <span className="playtest-hand__mv" aria-hidden>
                    {c.manaCost ? <ManaCost cost={c.manaCost} /> : c.manaValue}
                  </span>
                )}
              </div>
            ) : (
              renderCard(c, i)
            )
          )}
        </div>
      )}
      {fan && (
        <button
          type="button"
          className="playtest-hand__toggle"
          onClick={toggle}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronUp aria-hidden width={14} height={14} />
          ) : (
            <ChevronDown aria-hidden width={14} height={14} />
          )}
          Hand ({cards.length})
        </button>
      )}
    </div>
  );
}
