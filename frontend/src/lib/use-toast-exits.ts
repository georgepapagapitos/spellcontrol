import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Toast } from '../store/toasts';

/**
 * Delayed-unmount + restack-glide driver for the toast viewport
 * (STYLE_GUIDE Motion pattern 5: leave = fade+drop `--motion-base`,
 * survivors glide to their new slot).
 *
 * The toasts store stays synchronous — `dismiss` removes the row
 * immediately, whatever the path (timeout expiry, manual ✕, action click,
 * cap eviction in `addToast`, `clear()`). This hook diffs the store list
 * between renders: a toast that vanished keeps rendering as a *leaving
 * ghost* with the `is-leaving` class until its `toast-leave` animation
 * ends, then `onExitEnd` drops it for real.
 *
 * Ghosts are pinned `position: absolute` at their last in-flow slot
 * (measured each commit, relative to the list's *bottom* edge — the stack
 * is bottom-anchored, so bottom-relative offsets are stable while the
 * list height shrinks and immune to keyboard-inset / viewport shifts).
 * Taking the ghost out of flow lets the survivors reflow immediately;
 * a FLIP pass then inverts each survivor's jump with a transform and
 * releases it into the `.toast` transform transition, so the restack
 * glides instead of teleporting — concurrently with the ghost's fade.
 *
 * Reduced motion (mirrors use-sheet-exit): the leave keyframe is
 * neutralized in CSS, so `animationend` would never fire — departures are
 * dropped immediately instead of ghosted, and the FLIP pass is skipped.
 */

export interface ToastRenderEntry {
  toast: Toast;
  /** True for a ghost playing its leave animation; render inert. */
  leaving: boolean;
  /** Pins a leaving ghost at its last in-flow slot (absent if never measured). */
  style?: CSSProperties;
}

interface ExitingToast {
  toast: Toast;
  /**
   * px from the list's bottom edge up to the toast's bottom edge at the
   * moment it departed; null when it was never measured (departed before
   * its first layout pass) — then the ghost stays in flow and the glide
   * simply happens when it unmounts.
   */
  bottomOffset: number | null;
}

interface MeasuredRect {
  /** Top edge relative to the list's bottom edge (list-relative, so viewport shifts don't read as restacks). */
  top: number;
  /** Distance from the list's bottom edge up to the item's bottom edge. */
  bottomOffset: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Toasts present in `prev` but gone from `next` (matched by id). */
export function computeDepartures(prev: Toast[], next: Toast[]): Toast[] {
  if (prev === next || prev.length === 0) return [];
  const liveIds = new Set(next.map((t) => t.id));
  return prev.filter((t) => !liveIds.has(t.id));
}

/**
 * FLIP release: start the element at its inverted (old) position with the
 * transition suppressed, force a style flush so that start point is
 * committed, then clear both — the `.toast` transform transition takes
 * over and glides the element to its new slot.
 */
export function applyRestackGlide(el: HTMLElement, deltaY: number): void {
  if (deltaY === 0) return;
  el.style.transition = 'none';
  el.style.transform = `translateY(${deltaY}px)`;
  // Forced reflow — without it the two writes coalesce and nothing glides.
  void el.offsetHeight;
  el.style.transition = '';
  el.style.transform = '';
}

export function useToastExits(toasts: Toast[]): {
  entries: ToastRenderEntry[];
  /** Attach to the <ol className="toast-list"> (the ghosts' offset parent). */
  listRef: React.RefObject<HTMLOListElement | null>;
  /** Callback ref for each toast <li>, keyed by toast id. */
  registerItem: (id: string, el: HTMLLIElement | null) => void;
  /** Call when a ghost's `toast-leave` animation ends. */
  onExitEnd: (id: string) => void;
} {
  const [exiting, setExiting] = useState<ExitingToast[]>([]);
  const listRef = useRef<HTMLOListElement | null>(null);
  const itemsRef = useRef(new Map<string, HTMLLIElement>());
  // Last in-flow measurements, written by the layout pass below and read at
  // render time to pin freshly departed ghosts (read-only during render).
  const rectsRef = useRef(new Map<string, MeasuredRect>());

  // Derive-state-from-props pattern: detect departures during render so the
  // ghost appears in the very commit the store row disappears (no blink
  // frame between unmount and re-mount).
  const [prevToasts, setPrevToasts] = useState(toasts);
  if (prevToasts !== toasts) {
    setPrevToasts(toasts);
    const departed = computeDepartures(prevToasts, toasts);
    if (departed.length > 0 && !prefersReducedMotion()) {
      setExiting((cur) => {
        const have = new Set(cur.map((e) => e.toast.id));
        const additions = departed
          .filter((t) => !have.has(t.id))
          .map((t) => ({
            toast: t,
            bottomOffset: rectsRef.current.get(t.id)?.bottomOffset ?? null,
          }));
        return additions.length > 0 ? [...cur, ...additions] : cur;
      });
    }
  }

  const registerItem = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) itemsRef.current.set(id, el);
    else itemsRef.current.delete(id);
  }, []);

  const onExitEnd = useCallback((id: string) => {
    setExiting((cur) =>
      cur.some((e) => e.toast.id === id) ? cur.filter((e) => e.toast.id !== id) : cur
    );
  }, []);

  // Measure + FLIP every commit: any in-flow toast whose slot moved since
  // the previous commit starts at its inverted old position and glides.
  // Leaving ghosts are skipped — they're absolutely pinned and animating out.
  useLayoutEffect(() => {
    const leavingIds = new Set(exiting.map((e) => e.toast.id));
    const reduce = prefersReducedMotion();
    const listBottom = listRef.current?.getBoundingClientRect().bottom ?? 0;
    const nextRects = new Map<string, MeasuredRect>();
    for (const [id, el] of itemsRef.current) {
      if (leavingIds.has(id)) continue;
      const rect = el.getBoundingClientRect();
      const measured: MeasuredRect = {
        top: rect.top - listBottom,
        bottomOffset: listBottom - rect.bottom,
      };
      const prev = rectsRef.current.get(id);
      if (!reduce && prev && prev.top !== measured.top) {
        applyRestackGlide(el, prev.top - measured.top);
      }
      nextRects.set(id, measured);
    }
    rectsRef.current = nextRects;
  });

  const liveIds = new Set(toasts.map((t) => t.id));
  const entries: ToastRenderEntry[] = [
    ...toasts.map((t) => ({ toast: t, leaving: false })),
    // Defensive id filter: a ghost colliding with a live id would break the
    // render keying (cannot happen with UUID ids, but cheap to guarantee).
    ...exiting
      .filter((e) => !liveIds.has(e.toast.id))
      .map((e) => ({
        toast: e.toast,
        leaving: true,
        style:
          e.bottomOffset == null
            ? undefined
            : ({
                position: 'absolute',
                bottom: `${e.bottomOffset}px`,
                left: 0,
                right: 0,
              } satisfies CSSProperties),
      })),
  ];

  return { entries, listRef, registerItem, onExitEnd };
}
