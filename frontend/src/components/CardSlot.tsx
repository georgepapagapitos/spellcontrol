import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';
import { isLand } from '../lib/colors';
import { truncateLongWords } from '../lib/slot-text';
import { CardPreviewContext } from './CardPreviewContext';

interface Props {
  card: EnrichedCard | null;
}

interface TooltipPos {
  x: number;
  y: number;
}

const TIP_MARGIN = 8;
const VIEWPORT_PAD = 6;

// Devices with a real hover capability (mouse, trackpad) get the floating
// tooltip on mouseenter. Touch screens (no hover) instead open the swipeable
// CardPreview modal on tap, opted into via CardPreviewContext.
const hasHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches;

export function CardSlot({ card }: Props) {
  const preview = useContext(CardPreviewContext);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const [imgError, setImgError] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImgError(false);
  }, [card?.imageNormal]);

  // Measure the rendered tooltip and pick the best placement around the slot:
  // right → left → below → above, with viewport clamping. Measuring the real DOM
  // (instead of estimating) keeps tall tooltips from getting cut off after the
  // card image loads.
  const reposition = useCallback(() => {
    const slot = slotRef.current;
    const tip = tooltipRef.current;
    if (!slot || !tip) return;
    const slotRect = slot.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const tipW = tipRect.width;
    const tipH = tipRect.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsRight = slotRect.right + TIP_MARGIN + tipW <= vw - VIEWPORT_PAD;
    const fitsLeft = slotRect.left - TIP_MARGIN - tipW >= VIEWPORT_PAD;
    const fitsBelow = slotRect.bottom + TIP_MARGIN + tipH <= vh - VIEWPORT_PAD;

    let x: number;
    let y: number;
    if (fitsRight) {
      x = slotRect.right + TIP_MARGIN;
      y = slotRect.top;
    } else if (fitsLeft) {
      x = slotRect.left - TIP_MARGIN - tipW;
      y = slotRect.top;
    } else {
      x = Math.round(slotRect.left + slotRect.width / 2 - tipW / 2);
      y = fitsBelow ? slotRect.bottom + TIP_MARGIN : slotRect.top - TIP_MARGIN - tipH;
    }

    x = Math.max(VIEWPORT_PAD, Math.min(x, vw - tipW - VIEWPORT_PAD));
    y = Math.max(VIEWPORT_PAD, Math.min(y, vh - tipH - VIEWPORT_PAD));

    setPos((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
  }, []);

  // Position once after render, and again whenever something that affects size changes.
  useLayoutEffect(() => {
    if (!hovered) return;
    reposition();
  }, [hovered, card, imgError, reposition]);

  // Keep the popup pinned correctly while it's visible.
  useEffect(() => {
    if (!hovered) return;
    const handler = () => reposition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [hovered, reposition]);

  const show = () => {
    if (hasHover) setHovered(true);
  };
  const hide = () => {
    setHovered(false);
    setPos(null);
  };
  const handleClick = () => {
    if (!hasHover && card) preview?.openCard(card);
  };

  if (!card) return <div className="slot empty" />;

  const cls = getSlotClass(card);
  const displayName = truncateLongWords(card.name);

  return (
    <>
      <div
        ref={slotRef}
        className={`slot ${cls}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={handleClick}
        tabIndex={0}
        role={!hasHover ? 'button' : undefined}
        aria-label={!hasHover ? `Open details for ${card.name}` : undefined}
      >
        <span className="slot-name">{displayName}</span>
      </div>
      {hovered && (
        <div
          ref={tooltipRef}
          className="tooltip"
          role="tooltip"
          style={{
            left: pos ? pos.x : 0,
            top: pos ? pos.y : 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className="tooltip-name">{card.name}</div>
          <div className="tooltip-meta">
            {card.rarity} · ${card.purchasePrice.toFixed(2)}
            {card.cmc !== undefined ? ` · CMC ${card.cmc}` : ''}
            <br />
            {card.setName || card.setCode}
            {card.typeLine ? (
              <>
                <br />
                {card.typeLine}
              </>
            ) : null}
          </div>
          {card.imageNormal && !imgError && (
            <img
              src={card.imageNormal}
              alt={card.name}
              className="tooltip-image"
              loading="lazy"
              onError={() => setImgError(true)}
              onLoad={reposition}
            />
          )}
          {card.imageNormal && imgError && (
            <div className="tooltip-img-fallback">Image unavailable</div>
          )}
        </div>
      )}
    </>
  );
}

function getSlotClass(card: EnrichedCard): string {
  if (isLand(card)) return 'land';
  return card.rarity.toLowerCase() || 'common';
}
