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
   * The sheet element being dragged. The hook writes `transform: translateY()`
   * straight to this node on every touchmove — the per-frame drag never goes
   * through React. Routing the offset through state would re-render the whole
   * modal subtree ~60×/s, which is exactly what made the drag feel laggy.
   */
  sheetRef: RefObject<HTMLElement | null>;
  /**
   * Optional reference to a horizontally-scrolling element nested inside the
   * sheet (e.g. a card carousel). While the gesture is locked vertical, the
   * hook pins this element's scrollLeft so sideways finger motion during a
   * dismiss drag cannot also scroll it.
   */
  trackRef?: RefObject<HTMLElement | null>;
  /**
   * Optional gate checked at the moment a vertical drag would commit. Return
   * false to let the touch fall through to native scrolling instead of starting
   * a dismiss — e.g. a sheet whose body scrolls vertically returns
   * `scrollTop <= 0` so the swipe only dismisses once the content is at the top.
   * Omitted → vertical drags always start a dismiss (the carousel's behavior,
   * where the nested scroll is horizontal so there's nothing to defer to).
   */
  canStartDrag?: () => boolean;
}

interface Result {
  /**
   * True while the user is actively dragging vertically. Drives the sheet's
   * `is-dragging` class, which suppresses the snap-back CSS transition so the
   * sheet tracks the finger 1:1. Toggles exactly twice per gesture (commit /
   * release) — never per frame — so it stays clear of the hot path.
   */
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
 *
 * The drag offset is applied imperatively to `sheetRef` — no React state, no
 * re-render per frame. The consumer is responsible for two things:
 *  - render the `is-dragging` class while `isDragging` is true;
 *  - once `isDragging` flips false (and the sheet is not closing), clear the
 *    sheet's inline `transform` in a layout effect. With `is-dragging` gone
 *    the CSS `:not(.is-dragging)` transition is live, so clearing it animates
 *    the snap-back home. On a dismiss the transform is left in place for the
 *    `sheet-fall` keyframe to take over from.
 */
export function useSwipeDownDismiss({
  onDismiss,
  sheetRef,
  trackRef,
  canStartDrag,
}: Options): Result {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const axisLockRef = useRef<'h' | 'v' | null>(null);
  // When the gesture locks vertical, pin the carousel's horizontal scroll
  // position so any sideways finger motion during the dismiss drag can't
  // also scroll it.
  const lockedScrollLeftRef = useRef<number | null>(null);

  const reset = () => {
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
      // no visual movement, since the offset is clamped to ≥ 0).
      const hCommit = Math.abs(dx) > AXIS_LOCK_THRESHOLD_PX;
      const vCommit = dy > AXIS_LOCK_THRESHOLD_PX;
      if (hCommit || vCommit) {
        // Vertical-dominant downward drag becomes a dismiss only when the
        // consumer's gate allows it (e.g. scroll body at the top). When it's
        // gated off we lock 'h' — deferring the WHOLE gesture to native scroll
        // — rather than leaving the lock open, which would let a later move
        // catch 'v' mid-drag and jump the sheet by the accumulated delta.
        const verticalDismiss = vCommit && dy > Math.abs(dx) && (canStartDrag?.() ?? true);
        axisLockRef.current = verticalDismiss ? 'v' : 'h';
        if (axisLockRef.current === 'v') {
          // Flipping `isDragging` re-renders the modal subtree (up to ~25
          // mounted carousel slides). Doing it synchronously inside the
          // committing touchmove drops the dismiss gesture's FIRST frame — the
          // drag visibly "catches" as it starts. The offset is written
          // imperatively to the sheet below regardless, so the is-dragging
          // class (snap-back suppression) can safely land one frame later.
          // Defer it to the next frame; guard on the lock still being 'v' so a
          // tap that ends before the rAF fires can't strand the sheet in a
          // dragging state (touchEnd resets the lock to null synchronously).
          const raf =
            typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame
              : (cb: () => void) => setTimeout(cb, 0);
          raf(() => {
            if (axisLockRef.current === 'v') setIsDragging(true);
          });
        }
      }
    }
    if (axisLockRef.current === 'v') {
      // Only respond to downward drag; ignore upward. Write the offset
      // straight to the DOM — bypassing React keeps the drag a pure
      // compositor transform with zero re-renders per frame.
      const offset = Math.max(0, dy);
      const sheet = sheetRef.current;
      if (sheet) sheet.style.transform = `translateY(${offset}px)`;
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
    reset();
    // Dismiss if dragged far enough OR flicked down hard. Hand the release
    // offset to onDismiss so the exit slide (sheet-fall keyframe) continues
    // from there rather than jerking back to the top. The inline transform is
    // intentionally left in place: the keyframe overrides it from `fromY`.
    // On a non-dismiss release the consumer's layout effect clears it once
    // `isDragging` flips false, letting the CSS transition animate it home.
    if (dy > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY) {
      onDismiss(Math.max(0, dy));
    }
  };

  return {
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
