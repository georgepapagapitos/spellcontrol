import { useRef, useState, type RefObject } from 'react';

/** Tunables — same constants both sheets used independently. */
const AXIS_LOCK_THRESHOLD_PX = 8;
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY = 0.6;

interface Options {
  /**
   * Called when the user has dragged far enough or flicked down hard enough
   * to dismiss. Receives the release offset in px so the exit slide can
   * continue from where the finger left off instead of snapping back to 0.
   */
  onDismiss: (fromY: number) => void;
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
      // Upward drags are ignored entirely — only commit a vertical lock
      // when the user is actually dragging DOWN. Otherwise an up-flick
      // would pin the carousel's horizontal scroll for the rest of the
      // gesture (and could leave the sheet in a "dragging" state with
      // no visual movement, since dragY is clamped to ≥ 0).
      const hCommit = Math.abs(dx) > AXIS_LOCK_THRESHOLD_PX;
      const vCommit = dy > AXIS_LOCK_THRESHOLD_PX;
      if (hCommit || vCommit) {
        axisLockRef.current = vCommit && dy > Math.abs(dx) ? 'v' : 'h';
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
        // eslint-disable-next-line react-hooks/immutability -- imperative DOM scroll pin in event handler, not a render side-effect
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
    // Dismiss if dragged far enough OR flicked down hard. Capture the release
    // offset before reset() zeroes dragY, then hand it to onDismiss so the
    // exit slide continues from there rather than jerking back to the top.
    if (dy > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY) {
      const fromY = Math.max(0, dy);
      reset();
      onDismiss(fromY);
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
