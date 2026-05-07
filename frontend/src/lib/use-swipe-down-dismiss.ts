import { useRef, useState, type RefObject } from 'react';

/** Tunables — same constants both sheets used independently. */
const AXIS_LOCK_THRESHOLD_PX = 8;
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY = 0.6;

interface Options {
  /** Called when the user has dragged far enough or flicked down hard enough to dismiss. */
  onDismiss: () => void;
  /**
   * Optional reference to a horizontally-scrolling element nested inside the
   * sheet (e.g. a card carousel). While the gesture is locked vertical, the
   * hook pins this element's scrollLeft so sideways finger motion during a
   * dismiss drag cannot also scroll it.
   */
  trackRef?: RefObject<HTMLElement | null>;
}

interface Result {
  /** Current vertical drag distance in px; 0 when the gesture is idle. */
  dragY: number;
  /** True while the user is actively dragging vertically. */
  isDragging: boolean;
  /**
   * Live read of the axis lock — `null` until the gesture commits, then `'v'`
   * for vertical (dismiss) or `'h'` for horizontal (let nested scroll handle it).
   * Exposed so callers can suppress unrelated motion (e.g. holographic tilt)
   * while a swipe is in flight.
   */
  axisLockRef: RefObject<'h' | 'v' | null>;
  /** Spread these onto the sheet element to wire the gesture up. */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: (e: React.TouchEvent) => void;
  };
}

/**
 * Swipe-down-to-dismiss gesture for full-screen sheets / modals.
 *
 * Tracks vertical drag on the sheet; axis-locks on the first significant
 * move so horizontal swipes inside a nested carousel still drive its
 * native scroll-snap. Up swipes are intentionally ignored. The sheet is
 * dismissed if the user drags far enough OR flicks down hard.
 */
export function useSwipeDownDismiss({ onDismiss, trackRef }: Options): Result {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const axisLockRef = useRef<'h' | 'v' | null>(null);
  // When the gesture locks vertical, pin the carousel's horizontal scroll
  // position so any sideways finger motion during the dismiss drag can't
  // also scroll it.
  const lockedScrollLeftRef = useRef<number | null>(null);

  const reset = () => {
    setDragY(0);
    axisLockRef.current = null;
    lockedScrollLeftRef.current = null;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    dragStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    axisLockRef.current = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axisLockRef.current === null) {
      if (Math.abs(dx) > AXIS_LOCK_THRESHOLD_PX || Math.abs(dy) > AXIS_LOCK_THRESHOLD_PX) {
        axisLockRef.current = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
        if (axisLockRef.current === 'v') setIsDragging(true);
      }
    }
    if (axisLockRef.current === 'v') {
      // Only respond to downward drag; ignore upward.
      setDragY(Math.max(0, dy));
      const track = trackRef?.current;
      if (track) {
        if (lockedScrollLeftRef.current === null) {
          lockedScrollLeftRef.current = track.scrollLeft;
        }
        track.scrollLeft = lockedScrollLeftRef.current;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (!start || axisLockRef.current !== 'v') {
      reset();
      return;
    }
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.t);
    const velocity = dy / dt;
    // Dismiss if dragged far enough OR flicked down hard.
    if (dy > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY) {
      reset();
      onDismiss();
    } else {
      reset();
    }
  };

  return {
    dragY,
    isDragging,
    axisLockRef,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}
