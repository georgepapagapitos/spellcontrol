import { useRef, type RefObject } from 'react';

/** The three resting heights of the card preview's info sheet. */
export type SheetStop = 'peek' | 'half' | 'full';
export const SHEET_STOPS: readonly SheetStop[] = ['peek', 'half', 'full'];

const AXIS_LOCK_PX = 8;
/** Dragging this far below the peek stop closes the preview. */
const DISMISS_PAST_PEEK_PX = 90;
const DISMISS_VELOCITY = 0.8;
/** How far a release's velocity carries the sheet when picking a stop (ms). */
const FLING_MS = 160;

interface Options {
  /** The sheet itself, moved by `translateY`; the stop's resting offset comes from CSS. */
  panelRef: RefObject<HTMLElement | null>;
  /** The scroll region inside the sheet — it scrolls natively at the full stop. */
  innerRef: RefObject<HTMLElement | null>;
  /** The card stage; its height is the viewport minus the peek stop. */
  stageRef: RefObject<HTMLElement | null>;
  stop: SheetStop;
  onStop: (stop: SheetStop) => void;
  onDismiss: () => void;
  /** False in the two-column layout, where the panel is a column that just scrolls. */
  enabled: () => boolean;
}

/**
 * Drag the stacked card preview's info sheet between its stops. The sheet is
 * one fixed-height element moved by transform, so the card above it never
 * resizes (the #636 stable-frame rule, now structural). The drag writes the
 * offset straight to the DOM and only commits a stop on release; clearing the
 * inline transform lets the CSS transition carry the sheet to that stop.
 *
 * At the peek and half stops every vertical drag moves the sheet. At full the
 * content scrolls natively, and a downward drag moves the sheet only once the
 * content is back at its top. Handlers stop propagation so the preview's own
 * swipe-down-to-close (on the whole dialog) never sees a sheet gesture.
 */
export function useSheetStops({
  panelRef,
  innerRef,
  stageRef,
  stop,
  onStop,
  onDismiss,
  enabled,
}: Options) {
  const g = useRef<{
    x: number;
    y: number;
    t: number;
    base: number;
    lock: 'drag' | 'native' | null;
  } | null>(null);

  const offsets = () => {
    const panel = panelRef.current!;
    const full = panel.offsetHeight;
    const sheetH = panel.parentElement?.clientHeight ?? full;
    const peekH = sheetH - (stageRef.current?.offsetHeight ?? sheetH - full);
    const halfH = Math.max(peekH, sheetH * 0.58);
    return { full: 0, half: Math.max(0, full - halfH), peek: Math.max(0, full - peekH) };
  };

  const end = (y: number) => {
    const s = g.current;
    g.current = null;
    const panel = panelRef.current;
    if (!s || s.lock !== 'drag' || !panel) return;
    const dy = y - s.y;
    const v = dy / Math.max(1, Date.now() - s.t);
    const at = s.base + dy;
    const o = offsets();
    panel.classList.remove('is-dragging');
    if (at > o.peek + DISMISS_PAST_PEEK_PX || (stop === 'peek' && v > DISMISS_VELOCITY)) {
      onDismiss();
      return;
    }
    const aim = at + v * FLING_MS;
    const next = SHEET_STOPS.reduce((best, k) =>
      Math.abs(o[k] - aim) < Math.abs(o[best] - aim) ? k : best
    );
    panel.style.transform = '';
    onStop(next);
  };

  return {
    onTouchStart: (e: React.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length !== 1 || !enabled() || !panelRef.current) return;
      const t = e.touches[0];
      const m = new DOMMatrixReadOnly(getComputedStyle(panelRef.current).transform);
      g.current = { x: t.clientX, y: t.clientY, t: Date.now(), base: m.m42, lock: null };
    },
    onTouchMove: (e: React.TouchEvent) => {
      e.stopPropagation();
      const s = g.current;
      const panel = panelRef.current;
      if (!s || !panel) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (s.lock === null) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        const inner = innerRef.current;
        const inContent = !!inner && inner.contains(e.target as Node);
        const contentScrolls =
          stop === 'full' && inContent && (dy < 0 || (inner?.scrollTop ?? 0) > 0);
        s.lock = Math.abs(dy) > Math.abs(dx) && !contentScrolls ? 'drag' : 'native';
        if (s.lock === 'drag') panel.classList.add('is-dragging');
      }
      if (s.lock === 'drag') panel.style.transform = `translateY(${Math.max(0, s.base + dy)}px)`;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.stopPropagation();
      end(e.changedTouches[0]?.clientY ?? g.current?.y ?? 0);
    },
    onTouchCancel: (e: React.TouchEvent) => {
      e.stopPropagation();
      end(g.current?.y ?? 0);
    },
  };
}

/** Handle tap / Enter: peek → half → full → peek. */
export function nextStop(stop: SheetStop): SheetStop {
  return SHEET_STOPS[(SHEET_STOPS.indexOf(stop) + 1) % SHEET_STOPS.length];
}
