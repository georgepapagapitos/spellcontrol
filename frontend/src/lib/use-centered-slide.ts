import { useEffect, useRef, type RefObject } from 'react';

/**
 * Tracks which slide inside `trackRef` is centered horizontally and reports
 * the index via `onCenter`. Active = the slide whose center is closest to
 * the track's center. Pure ratio-based picking ties when multiple slides
 * are 100% visible (which happens whenever a neighbor fully fits the
 * viewport too) and would lock onto the wrong one. Center-distance has no
 * ties.
 *
 * `deps` should change whenever the set of slides changes (e.g. the array
 * driving the carousel).
 */
export function useCenteredSlide(
  trackRef: RefObject<HTMLElement | null>,
  slideRefs: RefObject<Array<HTMLElement | null>>,
  onCenter: (index: number) => void,
  deps: ReadonlyArray<unknown>
): void {
  const onCenterRef = useRef(onCenter);
  onCenterRef.current = onCenter;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      () => {
        const trackRect = track.getBoundingClientRect();
        const trackCenter = trackRect.left + trackRect.width / 2;
        let bestIdx = -1;
        let bestDist = Infinity;
        const slides = slideRefs.current;
        if (!slides) return;
        for (let i = 0; i < slides.length; i++) {
          const el = slides[i];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          // Cheap visibility gate: if the slide is entirely outside the track
          // viewport, skip the abs() math.
          if (r.right < trackRect.left || r.left > trackRect.right) continue;
          const dist = Math.abs(r.left + r.width / 2 - trackCenter);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) onCenterRef.current(bestIdx);
      },
      { root: track, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    slideRefs.current?.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
