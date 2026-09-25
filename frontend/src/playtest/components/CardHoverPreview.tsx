import { useEffect, useState } from 'react';
import { useMediaQuery } from '@/lib/use-media-query';
import type { PtDisplay } from '../lib/power-toughness';
import { CardCounters } from './CardCounters';
import { CardPtBox } from './PlaytestCardFace';
import { previewSlot } from '../lib/preview-slot';
import './CardHoverPreview.css';

const SELECTOR = '[data-preview-id]';
/** A tap on another hand card swaps the preview rather than dismissing it,
 *  so the hand can be read card by card with no blink between them. */
const HAND_CARD = `.playtest-hand ${SELECTOR}`;
/** Between the two faces of a two-faced card. */
const FACE_GAP = 8;

/** The art to enlarge: the face showing, and the other one when the card has
 *  two (transform, modal double-faced). */
export interface PreviewFaces {
  src: string;
  back?: string;
  /** A permanent's counters, drawn on the enlarged face as on the card. */
  counters?: Record<string, number>;
  /** The body the board reads (counters and pumps folded in), in the same
   *  plates as the card, since the art only prints what the card started as. */
  pt?: PtDisplay;
}

interface Props {
  /** Hidden while true — a drag in progress, or any sheet/menu open. */
  suspended: boolean;
  /** The faces for a card instance id, or null when it has none to show
   *  (face-down, no art). The DOM carries only the id (`data-preview-id`);
   *  the URLs always come from here, i.e. from React state. */
  resolve(cardId: string): PreviewFaces | null;
  /** The card a finger tapped, shown until the next tap anywhere else (touch
   *  has no hover to rest on, so the tap stands in for it). */
  pinned?: string | null;
  /** The pinned card is done with: a tap landed off the hand. */
  onUnpin?(): void;
}

interface Target extends PreviewFaces {
  rect: DOMRect;
  /** The hovered card is a token copy (`data-token`). The enlarged art is
   *  the art of the card it copied, so without this the one surface that
   *  shows a card at reading size is also the one that hides the
   *  difference. */
  isToken: boolean;
}

function read(el: Element, resolve: Props['resolve']): Target | null {
  const id = el.getAttribute('data-preview-id');
  const faces = id ? resolve(id) : null;
  return faces
    ? { ...faces, rect: el.getBoundingClientRect(), isToken: el.hasAttribute('data-token') }
    : null;
}

/**
 * Full-size card face beside the board for whatever card the pointer rests
 * on (or keyboard focus lands on). Event-delegated off `document` on the
 * `data-preview-id` attribute `PlaytestCardFace` sets, so every card
 * surface — battlefield, hand, drag overlay excluded by `suspended` — gets
 * it with no per-card wiring. Touch has no hover: a tap on a hand card pins
 * it instead (`pinned`), in the same slot, until the next tap elsewhere.
 *
 * It shows the moment the pointer lands on a card, with no delay and no
 * fade, and follows the pointer card to card (EDHPlay's; user feedback
 * 2026-09-23, "it should appear immediately"). It used to wait 220ms and
 * fade in over 120ms so a sweep across the hand would not flicker, which
 * read as the table being slow.
 */
export function CardHoverPreview({ suspended, resolve, pinned = null, onUnpin }: Props) {
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [hovered, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!finePointer) return;
    const show = (el: Element) => {
      const next = read(el, resolve);
      if (next) setTarget(next);
    };
    const hide = () => setTarget(null);
    const onOver = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (el) show(el);
    };
    const onOut = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (!el) return;
      const to = (e as MouseEvent).relatedTarget as Element | null;
      if (to && el.contains(to)) return;
      hide();
    };
    const onFocusIn = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (el) show(el);
      else hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('scroll', hide, true);
    };
  }, [finePointer, resolve]);

  useEffect(() => {
    if (!pinned || !onUnpin) return;
    const onDown = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.(HAND_CARD)) onUnpin();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pinned, onUnpin]);

  // Read at render, like the corner clusters below: the card is on screen
  // now or it has left the hand, and a card no longer there has nothing to
  // point the preview at.
  const pinnedEl = pinned
    ? document.querySelector(`[data-preview-id="${CSS.escape(pinned)}"]`)
    : null;
  const target = (finePointer ? hovered : null) ?? (pinnedEl ? read(pinnedEl, resolve) : null);
  if (suspended || !target) return null;

  // One fixed slot at the table's right edge, `min(22rem, 24vw)` as the
  // stylesheet says, placed clear of the card and the table's chrome (see
  // `previewSlot`). Read at render like the pinned card: the chrome moves
  // with the layout, not with React state.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(352, vw * 0.24);
  // A two-faced card shows both faces side by side, so the slot is two wide.
  const paneWidth = target.back ? width * 2 + FACE_GAP : width;
  const rects = (selector: string) =>
    [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
  const { left, top, scale } = previewSlot({
    vw,
    vh,
    paneWidth,
    height: width * 1.4,
    card: target.rect,
    corners: rects('.playtest-corner'),
    edges: rects('.playtest-zones-tab'),
    floor: rects('.playtest-piles, .playtest-hand--fan .playtest-hand__cards'),
  });

  return (
    <div
      className="playtest-hover-preview"
      style={{ left, top, width: paneWidth * scale }}
      aria-hidden
    >
      <div className="playtest-hover-preview__face">
        <img src={target.src} alt="" draggable={false} decoding="async" />
        {/* The same ribbon the card itself wears, on the same corner, at a
            size that suits the bigger face. */}
        {target.isToken && <span className="playtest-hover-preview__token">Token</span>}
        {target.counters && <CardCounters counters={target.counters} placement="inset" />}
        {target.pt && <CardPtBox pt={target.pt} />}
      </div>
      {target.back && (
        <div className="playtest-hover-preview__face">
          <img src={target.back} alt="" draggable={false} decoding="async" />
        </div>
      )}
    </div>
  );
}
