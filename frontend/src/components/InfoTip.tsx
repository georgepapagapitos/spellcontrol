import './InfoTip.css';
import { type JSX, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * The shared "ⓘ" info affordance — a small icon button beside a label that
 * reveals a plain-language explainer for a concept not everyone knows.
 *
 * The bubble is rendered through a PORTAL into <body> and positioned `fixed`,
 * because hosts can establish containing blocks / clip contexts that would
 * trap or clip an in-flow absolutely-positioned tooltip — e.g. a
 * `container-type` ancestor (the deck bento) traps `position: fixed`, and
 * `overflow: hidden` tables clip `position: absolute`. A portal escapes both.
 * Coordinates come from the trigger's rect, clamped to the viewport (flips above
 * when there's no room below), so it lands correctly on every breakpoint and
 * device — web and native.
 *
 * Reveal model (matches the app's hover-peek capability story):
 *   - mouse: hover opens, mouse-leave closes — so a click never PINS it open.
 *   - keyboard: focus opens, blur closes.
 *   - touch/native: a tap focuses the button → opens; tapping away blurs → closes.
 * Also closes on Escape and on any scroll/resize so it never floats stale.
 *
 * Presentational + accessible: `role="tooltip"` on the bubble, an
 * `aria-label` on the trigger. Pass rich `text` (a node) for multi-point
 * explainers — see the `.info-tip-lead` / `.info-tip-list` helpers.
 */
interface TipPos {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

export interface InfoTipProps {
  /** Used for the trigger's aria-label ("What is {label}?"). */
  label: string;
  /** The explainer body — a string or rich node (intro + list, etc.). */
  text: ReactNode;
  /** Roomier bubble — for consolidated, multi-point explainers. */
  wide?: boolean;
}

export function InfoTip({ label, text, wide }: InfoTipProps): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<TipPos | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(wide ? 360 : 300, vw - 16);
    // Left-align to the trigger, then clamp so the bubble stays on-screen.
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    // Prefer below; flip above when the lower gutter is too short.
    const belowSpace = vh - r.bottom;
    if (belowSpace >= 150 || belowSpace >= r.top) {
      setPos({ left, top: r.bottom + 6, width });
    } else {
      setPos({ left, bottom: vh - r.top + 6, width });
    }
  }, [wide]);

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // Capture-phase scroll so an inner scroll container also dismisses it.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos, close]);

  return (
    <span className="info-tip">
      <button
        ref={btnRef}
        type="button"
        className="info-tip-btn"
        aria-label={`What is ${label}?`}
        onMouseEnter={place}
        onMouseLeave={close}
        onFocus={place}
        onBlur={close}
      >
        <Info width={13} height={13} aria-hidden />
      </button>
      {pos &&
        createPortal(
          <span
            className={`info-tip-bubble${wide ? ' info-tip-bubble--wide' : ''}`}
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}
