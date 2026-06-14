import { useEffect, useRef, useState } from 'react';

/**
 * Android Material-style pull-to-refresh for the app's single scroll container
 * (native only — wire it from Layout against `app-main`). The content does not
 * move; an indicator descends from the top as the user drags down past the
 * threshold, then spins until `onRefresh` settles.
 *
 * Engages only when the container is scrolled to the very top and the drag is
 * downward, so normal scrolling is untouched. The threshold/clamp are exported
 * so the indicator can render its fill from the same numbers.
 */
export const PTR_THRESHOLD = 64; // px of pull (after resistance) that arms a refresh
export const PTR_MAX = 96; // px the indicator can travel
const RESISTANCE = 0.5; // finger travel → indicator travel (rubber-band feel)
const MIN_SPIN_MS = 500; // keep the spinner up at least this long (avoid a flicker)

export type PtrStatus = 'idle' | 'pulling' | 'armed' | 'refreshing';

export interface PtrState {
  /** Current indicator travel in px (0…PTR_MAX). */
  pull: number;
  status: PtrStatus;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function usePullToRefresh(
  scrollEl: HTMLElement | null,
  onRefresh: () => Promise<void>,
  enabled = true
): PtrState {
  const [pull, setPull] = useState(0);
  const [status, setStatus] = useState<PtrStatus>('idle');

  // Refs mirror state for the listener closures (attached once) and hold the
  // latest onRefresh so the effect doesn't re-bind on every render.
  const statusRef = useRef<PtrStatus>('idle');
  const startY = useRef(0);
  const engaged = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const set = (next: PtrStatus, dist: number) => {
    statusRef.current = next;
    setStatus(next);
    setPull(dist);
  };

  useEffect(() => {
    if (!scrollEl || !enabled) return;

    const onStart = (e: TouchEvent) => {
      if (statusRef.current === 'refreshing') return;
      if (e.touches.length !== 1 || scrollEl.scrollTop > 0) {
        engaged.current = false;
        return;
      }
      startY.current = e.touches[0].clientY;
      engaged.current = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!engaged.current || statusRef.current === 'refreshing') return;
      const dy = e.touches[0].clientY - startY.current;
      // Dragging up, or the list scrolled away from the top → hand back to the
      // native scroller.
      if (dy <= 0 || scrollEl.scrollTop > 0) {
        engaged.current = false;
        if (statusRef.current !== 'idle') set('idle', 0);
        return;
      }
      // We own this gesture now — stop the browser's overscroll/scroll.
      e.preventDefault();
      const dist = Math.min(PTR_MAX, dy * RESISTANCE);
      set(dist >= PTR_THRESHOLD ? 'armed' : 'pulling', dist);
    };

    const onEnd = () => {
      if (!engaged.current) return;
      engaged.current = false;
      if (statusRef.current !== 'armed') {
        set('idle', 0);
        return;
      }
      set('refreshing', PTR_THRESHOLD); // rest position while spinning
      void Promise.allSettled([onRefreshRef.current(), delay(MIN_SPIN_MS)]).then(() =>
        set('idle', 0)
      );
    };

    scrollEl.addEventListener('touchstart', onStart, { passive: true });
    scrollEl.addEventListener('touchmove', onMove, { passive: false });
    scrollEl.addEventListener('touchend', onEnd, { passive: true });
    scrollEl.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      scrollEl.removeEventListener('touchstart', onStart);
      scrollEl.removeEventListener('touchmove', onMove);
      scrollEl.removeEventListener('touchend', onEnd);
      scrollEl.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollEl, enabled]);

  return { pull, status };
}
