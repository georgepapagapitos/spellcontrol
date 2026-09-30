import { useCallback, useEffect, useRef } from 'react';

interface Options {
  delayMs?: number;
  onLongPress(clientX: number, clientY: number): void;
  /** Called when a pending (or already-fired) press is cancelled by movement
   *  past the 6px slop — e.g. the gesture turned out to be a scroll — or by a
   *  second finger (a pinch). Lets a
   *  consumer that shows something eagerly on fire (a touch peek) tear it
   *  down; not called on a plain release before the delay elapses (that's
   *  just a tap). Optional — playtest's drag/reorder callers don't need it. */
  onCancelByMove?(): void;
}

/**
 * Touch-only long-press detector. Returns handlers to spread onto an element
 * alongside dnd-kit's listeners — long-press fires after `delayMs` of stationary
 * touch; any movement >6px or release cancels it. `consumedClick` indicates the
 * next click should be suppressed (because the long-press handled it).
 *
 * Generalized off the playtest opening-hand card (drag/reorder + preview) for
 * reuse by the deck/collection touch card-art peek (E129) — same primitive,
 * different consumer.
 */
export function useLongPress({ delayMs = 500, onLongPress, onCancelByMove }: Options) {
  const timer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    unlisten.current?.();
    unlisten.current = null;
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
      // A long-press is one finger held still. A second finger anywhere on
      // the screen makes it a pinch, which can land outside this element, so
      // the element's own touch events never see it.
      const onSecondFinger = (ev: TouchEvent) => {
        if (ev.touches.length < 2) return;
        cancel();
        onCancelByMove?.();
      };
      document.addEventListener('touchstart', onSecondFinger, { capture: true, passive: true });
      unlisten.current = () =>
        document.removeEventListener('touchstart', onSecondFinger, { capture: true });
    },
    [cancel, delayMs, onLongPress, onCancelByMove]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current || timer.current == null) return;
      const t = e.touches[0];
      const dx = t.clientX - startPos.current.x;
      const dy = t.clientY - startPos.current.y;
      if (Math.hypot(dx, dy) > 6) {
        cancel();
        onCancelByMove?.();
      }
    },
    [cancel, onCancelByMove]
  );

  // `e` is optional: use-touch-peek composes this hook and calls it bare.
  const onTouchEnd = useCallback(
    (e?: React.TouchEvent) => {
      cancel();
      // A long-press that fired opened something (a menu sheet) UNDER the
      // finger. Lifting it would still synthesize a click — delivered to
      // whatever now sits at that point, i.e. a random item of the menu the
      // press just opened. Cancelling the touch's default cancels that click
      // (React registers touchend non-passively, so this is honoured).
      if (fired.current && e?.cancelable) e.preventDefault();
    },
    [cancel]
  );

  const consumedClick = useCallback(() => {
    if (fired.current) {
      fired.current = false;
      return true;
    }
    return false;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, consumedClick };
}
