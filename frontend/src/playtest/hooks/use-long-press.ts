import { useCallback, useEffect, useRef } from 'react';

interface Options {
  delayMs?: number;
  toleranceMs?: number;
  onLongPress(clientX: number, clientY: number): void;
}

/**
 * Touch-only long-press detector. Returns handlers to spread onto an element
 * alongside dnd-kit's listeners — long-press fires after `delayMs` of stationary
 * touch; any movement >6px or release cancels it. `consumedClick` indicates the
 * next click should be suppressed (because the long-press handled it).
 */
export function useLongPress({ delayMs = 500, onLongPress }: Options) {
  const timer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Clear a pending timer if the element unmounts mid-press (card played,
  // mulligan re-deal) so it can't fire onLongPress for a card that's gone (F22).
  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startPos.current = { x: t.clientX, y: t.clientY };
      fired.current = false;
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress(t.clientX, t.clientY);
      }, delayMs);
    },
    [cancel, delayMs, onLongPress]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current || timer.current == null) return;
      const t = e.touches[0];
      const dx = t.clientX - startPos.current.x;
      const dy = t.clientY - startPos.current.y;
      if (Math.hypot(dx, dy) > 6) cancel();
    },
    [cancel]
  );

  const onTouchEnd = useCallback(() => {
    cancel();
  }, [cancel]);

  const consumedClick = useCallback(() => {
    if (fired.current) {
      fired.current = false;
      return true;
    }
    return false;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, consumedClick };
}
