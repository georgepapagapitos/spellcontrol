import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Quiet gap after the last wheel tick that ends the gesture and settles. */
const SETTLE_IDLE_MS = 140;
/** Gesture travel that still turns the page even without crossing halfway. */
const FLICK_MIN_PX = 120;
/** Snap is restored this long after the settle scroll starts. */
const SNAP_RESTORE_MS = 700;
/** Set on the track while the hook is driving scrollLeft (CSS turns snap off). */
const PAN_CLASS = 'is-wheel-panning';

/**
 * Trackpad support for the centered scroll-snap carousels: pan 1:1 with the
 * wheel deltas, then settle the nearest slide into center when the gesture
 * goes quiet.
 *
 * Why not native wheel scrolling: `scroll-snap-type: x mandatory` animates
 * back toward the current snap point between wheel ticks, and with
 * ~viewport-wide slides the gesture can never out-run it (measured: 1500px of
 * deltas plateaued ~300px out, then sprang back). Why not discrete page turns
 * driven by smooth `scrollIntoView` per gesture: the trackpad's momentum tail
 * keeps emitting wheel events after the fingers lift, and that input kills an
 * in-flight smooth scroll — the track ends up parked between snap points
 * (shipped, observed broken on a real trackpad). So the hook owns the scroll
 * position outright: snap is disabled (via PAN_CLASS) while it writes
 * `scrollLeft` directly, and the settle runs only once the stream is quiet —
 * every gesture ends centered by construction. If a new gesture interrupts a
 * settle, its own settle re-centers.
 *
 * The settle target is the slide `useCenteredSlide`'s observer currently
 * reports as centered; a gesture that traveled ≥ FLICK_MIN_PX without leaving
 * its starting slide advances one slide in the gesture direction, so a light
 * flick still turns the page.
 *
 * Touch swiping is untouched (no wheel events); ctrlKey wheel (trackpad
 * pinch-zoom) falls through to the browser. Every other wheel tick over the
 * track is claimed with preventDefault — Chrome only guarantees the FIRST
 * event of a scroll sequence is cancelable, so letting a vertical wobble tick
 * through would make the rest of the gesture uncancelable (also shipped,
 * also observed broken). Vertical wheel was natively inert on this x-only
 * track with the body locked.
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
  // Live mirror so the wheel listener (attached once) always reads the
  // current slide — same pattern as useCenteredSlide's onCenterRef.
  const stateRef = useRef({ selected, slideCount });
  useLayoutEffect(() => {
    stateRef.current = { selected, slideCount };
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let idleTimer = 0;
    let restoreTimer = 0;
    /** `selected` when the gesture began; -1 = no gesture in flight. */
    let gestureStart = -1;
    let totalDx = 0;

    const restoreSnap = () => track.classList.remove(PAN_CLASS);

    const settle = () => {
      idleTimer = 0;
      const { selected, slideCount } = stateRef.current;
      let target = selected;
      if (target === gestureStart && Math.abs(totalDx) >= FLICK_MIN_PX) {
        target = Math.min(slideCount - 1, Math.max(0, target + (totalDx > 0 ? 1 : -1)));
      }
      gestureStart = -1;
      totalDx = 0;
      slideRefs.current?.[target]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
      // Restore snap once the settle scroll had time to finish. If the
      // animation was killed early, mandatory snap's own re-snap on restore
      // still lands centered — either way no resting state sits off-snap.
      clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(restoreSnap, SNAP_RESTORE_MS);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // trackpad pinch-zoom
      e.preventDefault();
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      // A vertical-dominant tick never starts a pan, but once a gesture is in
      // flight its wobble ticks stay part of it.
      if (gestureStart === -1 && !horizontal) return;
      if (gestureStart === -1) gestureStart = stateRef.current.selected;
      clearTimeout(restoreTimer);
      track.classList.add(PAN_CLASS);
      track.scrollLeft += e.deltaX;
      totalDx += e.deltaX;
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(settle, SETTLE_IDLE_MS);
    };

    // Non-passive: preventDefault must actually stop the native scroll.
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(idleTimer);
      clearTimeout(restoreTimer);
      restoreSnap();
      track.removeEventListener('wheel', onWheel);
    };
  }, [trackRef, slideRefs]);
}
