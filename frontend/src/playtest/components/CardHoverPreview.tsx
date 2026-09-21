import { useEffect, useState } from 'react';
import { useMediaQuery } from '@/lib/use-media-query';
import './CardHoverPreview.css';

/** Wait before showing so a pointer sweeping across the hand doesn't flicker
 *  a preview per card; focus (keyboard) shows immediately. */
const HOVER_DELAY_MS = 220;
const MARGIN = 12;

interface Props {
  /** Hidden while true — a drag in progress, or any sheet/menu open. */
  suspended: boolean;
  /** Image URL for a card instance id, or null when it has none to show
   *  (face-down, no art). The DOM carries only the id (`data-preview-id`);
   *  the URL always comes from here, i.e. from React state. */
  resolve(cardId: string): string | null;
}

interface Target {
  src: string;
  rect: DOMRect;
  /** The hovered card is a token copy (`data-token`). The enlarged art is
   *  the art of the card it copied, so without this the one surface that
   *  shows a card at reading size is also the one that hides the
   *  difference. */
  isToken: boolean;
}

/**
 * Full-size card face beside the board for whatever card the pointer rests
 * on (or keyboard focus lands on). Event-delegated off `document` on the
 * `data-preview-id` attribute `PlaytestCardFace` sets, so every card
 * surface — battlefield, hand, drag overlay excluded by `suspended` — gets
 * it with no per-card wiring. Fine-pointer only: touch has no hover, and the
 * long-press → menu → Preview path already serves it.
 */
export function CardHoverPreview({ suspended, resolve }: Props) {
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!finePointer) return;
    const SELECTOR = '[data-preview-id]';
    let timer: number | null = null;
    const clear = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };
    const read = (el: Element): Target | null => {
      const id = el.getAttribute('data-preview-id');
      const src = id ? resolve(id) : null;
      return src
        ? { src, rect: el.getBoundingClientRect(), isToken: el.hasAttribute('data-token') }
        : null;
    };
    const show = (el: Element, delay: number) => {
      clear();
      const next = read(el);
      if (!next) return;
      timer = window.setTimeout(() => setTarget(next), delay);
    };
    const hide = () => {
      clear();
      setTarget(null);
    };
    const onOver = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (el) show(el, HOVER_DELAY_MS);
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
      if (el) show(el, 0);
      else hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('scroll', hide, true);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('scroll', hide, true);
    };
  }, [finePointer, resolve]);

  if (!finePointer || suspended || !target) return null;

  // One fixed slot: vertically centred at the table's right edge, matching
  // the stylesheet's `min(22rem, 24vw)`. It flips to the left edge only when
  // the hovered card itself would sit under the slot (a permanent parked at
  // the far right, a zone pile), so the face never covers what it describes.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(352, vw * 0.24);
  const height = width * 1.4;
  const rightSlot = vw - MARGIN * 2 - width;
  const r = target.rect;
  const centred = Math.max(MARGIN, (vh - height) / 2);
  const underRightSlot =
    r.right > rightSlot - MARGIN &&
    r.top < centred + height + MARGIN &&
    r.bottom > centred - MARGIN;
  const left = underRightSlot ? MARGIN * 2 : rightSlot;
  // The corner clusters (life panel top-left, turn/menu stack top-right) own
  // the top of the table; the pane starts below whichever one it would
  // otherwise cover, so the numeral and the turn button stay readable.
  let top = centred;
  for (const el of document.querySelectorAll('.playtest-corner')) {
    const c = el.getBoundingClientRect();
    if (c.right > left && c.left < left + width && c.bottom + MARGIN > top) {
      top = c.bottom + MARGIN;
    }
  }
  top = Math.min(top, Math.max(MARGIN, vh - height - MARGIN));

  return (
    <div className="playtest-hover-preview" style={{ left, top, width }} aria-hidden>
      <img src={target.src} alt="" draggable={false} decoding="async" />
      {/* The same ribbon the card itself wears, on the same corner, at a
          size that suits the bigger face. */}
      {target.isToken && <span className="playtest-hover-preview__token">Token</span>}
    </div>
  );
}
