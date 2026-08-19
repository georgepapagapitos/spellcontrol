import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Horizontal wheel travel that commits a page turn. */
const PAGE_THRESHOLD_PX = 80;
/** Ignore further wheel input while the smooth scroll to the new slide runs. */
const PAGE_COOLDOWN_MS = 500;
/** A gap this long between wheel events starts a fresh gesture. */
const GESTURE_IDLE_MS = 250;

/**
 * Turns trackpad two-finger panning (wheel events with a dominant deltaX) into
 * discrete page turns on a centered scroll-snap carousel.
 *
 * Native wheel scrolling is unusable on these tracks: each wheel tick moves the
 * scroller a few dozen px, and `scroll-snap-type: x mandatory` immediately
 * animates it back toward the current snap point between ticks. With
 * ~viewport-wide slides the gesture can never out-run the snap-back (measured:
 * 1500px of wheel deltas plateaued ~300px out, then sprang back), so a trackpad
 * swipe rubber-bands to the same slide forever and mid-gesture the slide sits
 * visibly off-center. Instead of letting the two engines fight, a
 * horizontal-dominant wheel gesture accumulates toward a threshold and then
 * pages one slide via the same smooth `scrollIntoView` the arrow buttons use.
 *
 * Touch swiping is untouched (no wheel events); vertical wheel input and
 * ctrlKey wheel (trackpad pinch-zoom) fall through to the browser.
 *
 * Used by the two card-inspect carousels (`CardPreview`, `BinderPagePreview`),
 * which share the same centered scroll-snap track model.
 */
export function useWheelPaging(
  trackRef: RefObject<HTMLElement | null>,
  slideRefs: RefObject<Array<HTMLElement | null>>,
  selected: number,
  slideCount: number
): void {
  // Live mirror so the wheel listener (attached once) always pages from the
  // current slide — same pattern as useCenteredSlide's onCenterRef.
  const stateRef = useRef({ selected, slideCount });
  useLayoutEffect(() => {
    stateRef.current = { selected, slideCount };
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let acc = 0;
    let lockedUntil = 0;
    let lastEvent = 0;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      // Claim the gesture even while locked/under threshold — letting any tick
      // through to the native scroller restarts the snap fight this hook exists
      // to prevent.
      e.preventDefault();
      const now = Date.now();
      if (now - lastEvent > GESTURE_IDLE_MS) acc = 0;
      lastEvent = now;
      if (now < lockedUntil) return;
      acc += e.deltaX;
      if (Math.abs(acc) < PAGE_THRESHOLD_PX) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      const { selected, slideCount } = stateRef.current;
      const next = Math.min(slideCount - 1, Math.max(0, selected + dir));
      if (next === selected) return;
      lockedUntil = now + PAGE_COOLDOWN_MS;
      slideRefs.current?.[next]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
    };

    // Non-passive: preventDefault must actually stop the native scroll.
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, [trackRef, slideRefs]);
}
