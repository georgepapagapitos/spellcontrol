import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

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
  useLayoutEffect(() => {
    onCenterRef.current = onCenter;
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = slideRefs.current;
    if (!slides) return;

    // Element → index lookup so the hot callback never scans the full slide
    // list. With a large carousel (e.g. a multi-thousand-card collection
    // preview) an O(total) getBoundingClientRect() loop per scroll event is a
    // forced-reflow storm; here we only ever measure the slides the observer
    // reports as visible (typically 2–3).
    const indexOf = new Map<Element, number>();
    slides.forEach((el, i) => {
      if (el) indexOf.set(el, i);
    });
    const visible = new Set<Element>();

    const pickCenter = () => {
      const trackRect = track.getBoundingClientRect();
      const trackCenter = trackRect.left + trackRect.width / 2;
      let bestIdx = -1;
      let bestDist = Infinity;
      for (const el of visible) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - trackCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = indexOf.get(el) ?? -1;
        }
      }
      if (bestIdx >= 0) onCenterRef.current(bestIdx);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        pickCenter();
      },
      { root: track, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    slides.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
