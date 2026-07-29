import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live content-box width of an element, via ResizeObserver. `0` until the
 * element mounts.
 *
 * Card grids need their *own* width, not the viewport's, to know how many
 * columns a zoom step actually renders (see `zoomCols` in lib/grid-zoom.ts).
 *
 * Returns a **callback ref** rather than a ref object so it survives the
 * element remounting, and so it can be attached to several equal-width
 * elements at once — the deck view renders one grid per type section, all the
 * same width, and the last one to mount is the one observed. A ref object
 * would silently keep observing a detached node when the list re-groups.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    // happy-dom (the test env) has no ResizeObserver; the one-shot measure
    // above is enough there.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width] as const;
}
