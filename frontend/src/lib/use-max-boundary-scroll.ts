import { useEffect, type RefObject } from 'react';

/**
 * Snap an out-of-range horizontal scroll offset back to the nearest valid
 * edge. Pure (no DOM) so the boundary math is unit-testable on its own.
 *
 * The valid range is `[0, scrollWidth - clientWidth]`. A track that isn't
 * overflowing (content ≤ viewport) clamps everything to 0.
 */
export function clampScrollOffset(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number
): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (scrollLeft < 0) return 0;
  if (scrollLeft > max) return max;
  return scrollLeft;
}

/**
 * Clamp a horizontally-scrolling track's `scrollLeft` to its valid range so a
 * native (Capacitor WebView) momentum fling can't rubber-band / overscroll
 * past the first or last slide.
 *
 * CSS `overscroll-behavior-x: contain` suppresses scroll *chaining* and the
 * Android over-scroll glow, but a fast momentum fling can still carry the
 * track a few px beyond the snap boundary, and iOS WKWebView reports a
 * transient negative / over-max `scrollLeft` during its rubber-band. This hook
 * is the JS backstop: on every scroll it snaps an out-of-range `scrollLeft`
 * back to the nearest edge (which also cancels the momentum carrying it
 * there). In-range scrolling is untouched — the guard is a no-op while the
 * offset is valid — so normal swiping between slides is unaffected.
 *
 * Used by the two card-inspect carousels (`CardPreview`, `BinderPagePreview`),
 * which share the same centered scroll-snap track model.
 */
export function useMaxBoundaryScroll(trackRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Guards against a clamp→scroll→clamp feedback loop: the scrollLeft write
    // we make to correct an overshoot itself fires a scroll event, which we
    // swallow until the next frame.
    let correcting = false;
    const onScroll = () => {
      if (correcting) return;
      const clamped = clampScrollOffset(track.scrollLeft, track.scrollWidth, track.clientWidth);
      // >1px dead-zone: when `--slide-size` is fractional the clamp `max`
      // (scrollWidth - clientWidth) and the last slide's scroll-snap point
      // differ by a sub-pixel, so correcting every tiny delta makes the JS
      // clamp and the CSS snap engine fight at the boundary (micro-oscillation
      // that reads as swipe "wonk"). Only correct a real overshoot.
      if (Math.abs(clamped - track.scrollLeft) > 1) {
        correcting = true;
        track.scrollLeft = clamped;
        const raf =
          typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 0);
        raf(() => {
          correcting = false;
        });
      }
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [trackRef]);
}
