import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';
import { isLand } from '../lib/colors';
import { truncateLongWords } from '../lib/slot-text';
import { CardPreviewContext } from './CardPreviewContext';
import { getSetMap, type SetMap } from '../lib/api';

interface Props {
  card: EnrichedCard | null;
}

interface TooltipPos {
  x: number;
  y: number;
}

const TIP_MARGIN = 8;
const VIEWPORT_PAD = 6;

// Hover-capable pointers (real mouse/trackpad) get the floating tooltip on
// mouseenter. Click/tap opens the CardPreview modal on every device.
//
// `(hover: hover)` alone is unreliable on Chrome/Android, which often reports
// hover capability as true because the device *could* connect a stylus or
// mouse — even when the user is tapping with a finger. Combine with
// `(pointer: coarse)` so a coarse primary pointer (finger) suppresses the
// hover tooltip regardless.
const hasHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches &&
  !window.matchMedia('(pointer: coarse)').matches;

export function CardSlot({ card }: Props) {
  const preview = useContext(CardPreviewContext);
  const previewOpen = preview?.isPreviewOpen ?? false;
  const [hovered, setHovered] = useState(false);

  // Mouseenter from a slot underneath the preview modal still fires (the
  // backdrop doesn't capture pointer events from React's synthetic system),
  // so a stale tooltip would float over the carousel. Force-hide whenever
  // a preview is open.
  useEffect(() => {
    if (previewOpen) setHovered(false);
  }, [previewOpen]);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const [imgError, setImgError] = useState(false);
  const [setMap, setSetMap] = useState<SetMap | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImgError(false);
  }, [card?.imageNormal]);

  // Lazy-load the set map the first time a tooltip actually opens, so binder
  // pages that never get hovered don't trigger the fetch.
  useEffect(() => {
    if (!hovered || setMap) return;
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setSetMap(m);
      })
      .catch(() => {
        /* fall back to text-only set line */
      });
    return () => {
      cancelled = true;
    };
  }, [hovered, setMap]);

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
    if (hasHover && !previewOpen) setHovered(true);
  };
  const hide = () => {
    setHovered(false);
    setPos(null);
  };
  const handleClick = () => {
    if (card) preview?.openCard(card);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  if (!card) return <div className="slot empty" />;

  const cls = getSlotClass(card);
  const displayName = truncateLongWords(card.name);

  return (
    <>
      <div
        ref={slotRef}
        className={`slot ${cls}${card.foil ? ' foil' : ''}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`Open details for ${card.name}${card.foil ? ' (foil)' : ''}`}
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
            <span className={`tooltip-rarity rarity-${(card.rarity || '').toLowerCase()}`}>
              {card.rarity}
            </span>
            {card.foil && <span className="tooltip-foil">foil</span>}
            {' · '}${card.purchasePrice.toFixed(2)}
          </div>
          {(card.setName || card.setCode) && (
            <div className="tooltip-set">
              {card.setCode && setMap?.[card.setCode.toUpperCase()]?.iconSvgUri ? (
                <img
                  src={setMap[card.setCode.toUpperCase()].iconSvgUri}
                  alt=""
                  aria-hidden="true"
                  className="tooltip-set-icon"
                />
              ) : null}
              <span>{card.setName || card.setCode}</span>
            </div>
          )}
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
