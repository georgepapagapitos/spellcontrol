import { Layers } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { HOVER_HIDE_DELAY_MS, HOVER_INTENT_DELAY_MS } from '../lib/hover-intent';
import { useHoverCapable } from '../lib/use-hover-capable';
import { isLand } from '../lib/colors';
import { truncateLongWords } from '../lib/slot-text';
import { CardPreviewContext } from './CardPreviewContext';
import { getSetMap, type SetMap } from '../lib/api';
import { useAllocations } from '../lib/allocations';

interface Props {
  card: EnrichedCard | null;
  showImage?: boolean;
}

interface TooltipPos {
  x: number;
  y: number;
}

const TIP_MARGIN = 8;
const VIEWPORT_PAD = 6;

export function CardSlot({ card, showImage }: Props) {
  const preview = useContext(CardPreviewContext);
  const previewOpen = preview?.isPreviewOpen ?? false;
  const allocations = useAllocations();
  // Hover-capable pointers (real mouse/trackpad/stylus) get the floating tooltip;
  // touch/native tap to open the CardPreview modal instead. Shared, reactive gate
  // — same `(hover: hover) and (pointer: fine)` the deck hover-peek uses — so a
  // finger never raises it (Chrome/Android falsely reports plain `hover: hover`).
  const hoverCapable = useHoverCapable();
  const [hovered, setHovered] = useState(false);
  // Stable id so the slot can point `aria-describedby` at the tooltip while it's
  // shown (WAI-ARIA tooltip pattern); without it the role="tooltip" is inert for
  // assistive tech.
  const tooltipId = useId();
  // True while a show dwell is counting down (before the tooltip is shown). Used
  // to keep the scroll/resize teardown listener attached during the dwell too —
  // bounded to the one card currently dwelling, so a mid-dwell scroll cancels the
  // pending tooltip (mirrors the deck peek's always-on teardown without putting a
  // listener on every slot in the grid).
  const [dwelling, setDwelling] = useState(false);

  // Hover-intent timers (mouse only): a show dwell so the tooltip is raised after
  // a deliberate pause (never while the cursor just passes over), and a hide grace
  // so a brief exit — clipping the slot edge, dipping out and back — doesn't tear
  // it down. Keyboard focus opens it immediately (that's already deliberate).
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const cancelShow = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);
  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  // Mouseenter from a slot underneath the preview modal still fires (the
  // backdrop doesn't capture pointer events from React's synthetic system),
  // so a stale tooltip would float over the carousel. Force-hide whenever
  // a preview is open.
  const [prevPreviewOpen, setPrevPreviewOpen] = useState(previewOpen);
  if (prevPreviewOpen !== previewOpen) {
    setPrevPreviewOpen(previewOpen);
    if (previewOpen) {
      setHovered(false);
      setDwelling(false);
    }
  }
  // Cancel any dwell/grace still counting down when a preview opens, or a queued
  // tooltip would pop over the carousel after the click that opened it. In an
  // effect (not render) since it touches the timer refs; it runs before the
  // timers' macrotasks can fire, so nothing pending lands.
  useEffect(() => {
    if (previewOpen) {
      cancelShow();
      cancelHide();
    }
  }, [previewOpen, cancelShow, cancelHide]);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const [imgError, setImgError] = useState(false);
  const [setMap, setSetMap] = useState<SetMap | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Tear the tooltip down now (no grace): used for scroll, Escape, and an
  // unmount/preview-open. Clears a pending dwell as well as a shown tooltip.
  const hideNow = useCallback(() => {
    cancelShow();
    cancelHide();
    setDwelling(false);
    setHovered(false);
    setPos(null);
  }, [cancelShow, cancelHide]);

  const [prevImageNormal, setPrevImageNormal] = useState(card?.imageNormal);
  if (prevImageNormal !== card?.imageNormal) {
    setPrevImageNormal(card?.imageNormal);
    setImgError(false);
  }

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

  // Close the tooltip on scroll (any scrollable ancestor) and reposition on
  // resize. Attached while shown OR mid-dwell, so a scroll during the dwell
  // cancels the pending tooltip too (hideNow clears both); reposition only
  // matters once shown.
  useEffect(() => {
    if (!hovered && !dwelling) return;
    const onResize = () => reposition();
    window.addEventListener('scroll', hideNow, { capture: true, passive: true });
    if (hovered) window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', hideNow, true);
      window.removeEventListener('resize', onResize);
    };
  }, [hovered, dwelling, reposition, hideNow]);

  // WCAG 1.4.13 (content on hover/focus must be dismissable): Escape tears the
  // tooltip down without moving the pointer. Document-level + only while shown, so
  // it covers the pure-hover case too — the slot's own onKeyDown only fires when
  // the slot itself holds focus, which a mouse-hover user never gives it.
  useEffect(() => {
    if (!hovered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideNow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hovered, hideNow]);

  // Never leave a timer running past unmount (it would setState on a gone
  // component, or fire while the slot is recycled for another card).
  useEffect(
    () => () => {
      cancelShow();
      cancelHide();
    },
    [cancelShow, cancelHide]
  );

  // Mouse hover: raise the tooltip only after a deliberate dwell. Re-entering a
  // slot whose tooltip is up (or mid-grace) just cancels the teardown — no flash.
  const show = () => {
    if (!hoverCapable || previewOpen) return;
    cancelHide();
    if (hovered) return;
    cancelShow();
    setDwelling(true);
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      setDwelling(false);
      setHovered(true);
    }, HOVER_INTENT_DELAY_MS);
  };
  // Keyboard focus is already a deliberate act — no dwell, show at once. Still
  // gated on capability so a touch device with a keyboard doesn't build a tooltip
  // that CSS hides anyway (and fires its lazy set-map fetch); matches the mouse path.
  const showNow = () => {
    if (!hoverCapable || previewOpen) return;
    cancelHide();
    setHovered(true);
  };
  // Mouse leave: tear down after a short grace, so a brief exit doesn't flicker.
  const hide = () => {
    cancelShow();
    setDwelling(false);
    if (hideTimer.current !== null) return; // already counting down
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setHovered(false);
      setPos(null);
    }, HOVER_HIDE_DELAY_MS);
  };
  const handleClick = () => {
    if (card) preview?.openCard(card);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
    // Escape-to-dismiss is handled by a document-level listener (above) so it
    // works for hover-shown tooltips, not only focus.
  };

  if (!card) return <div className="slot empty" />;

  const cls = getSlotClass(card);
  const displayName = truncateLongWords(card.name);
  const allocation = allocations.get(card.copyId);
  // Group-printings mode: paint a small ×N badge in the corner when the
  // slot is standing in for multiple copies of the same printing. Mirrors
  // the collection grid's qty pill so the affordance is consistent.
  const groupedQty = preview?.qtyByCopyId?.get(card.copyId) ?? 1;

  return (
    <>
      <div
        ref={slotRef}
        className={`slot ${cls}${card.foil ? ' foil' : ''}${allocation ? ' is-allocated' : ''}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={showNow}
        onBlur={hide}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`Open details for ${card.name}${card.foil ? ' (foil)' : ''}${
          allocation ? ` (in deck: ${allocation.deckName})` : ''
        }`}
        aria-describedby={hovered ? tooltipId : undefined}
      >
        {showImage && card.imageSmall ? (
          <img
            src={card.imageSmall}
            alt={card.name}
            className="slot-img"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="slot-name">{displayName}</span>
        )}
        {allocation && (
          <Link
            to={`/decks/${allocation.deckId}`}
            className="slot-deck-badge"
            style={
              { '--deck-color': allocation.deckColor || 'var(--accent)' } as React.CSSProperties
            }
            title={`In deck: ${allocation.deckName}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open deck ${allocation.deckName}`}
          >
            <Layers width={9} height={9} strokeWidth={2.2} aria-hidden />
          </Link>
        )}
        {groupedQty > 1 && (
          <span className="slot-qty-badge" aria-label={`${groupedQty} copies`}>
            ×{groupedQty}
          </span>
        )}
      </div>
      {hovered && (
        <div
          ref={tooltipRef}
          id={tooltipId}
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
            <div className="tooltip-image-wrap">
              <img
                src={card.imageNormal}
                // Decorative within the described region: the name is already the
                // tooltip's text, so an alt here just makes SRs announce it twice.
                alt=""
                className="tooltip-image"
                loading="lazy"
                onError={() => setImgError(true)}
                onLoad={reposition}
              />
              {allocation && (
                <span
                  className="slot-deck-badge tooltip-deck-badge"
                  style={
                    {
                      '--deck-color': allocation.deckColor || 'var(--accent)',
                    } as React.CSSProperties
                  }
                  title={`In deck: ${allocation.deckName}`}
                  aria-hidden="true"
                >
                  <Layers width={14} height={14} strokeWidth={2.2} aria-hidden />
                </span>
              )}
            </div>
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
