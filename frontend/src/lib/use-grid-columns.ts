import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks in a grid's resolved `grid-template-columns`, or `null` when the value
 * is not a laid-out track list.
 *
 * A laid-out grid resolves to plain lengths ("252px 252px 252px"), one per
 * track, and an `auto-fill` grid keeps its empty tracks in that list. Anything
 * else (`none`, or the declared `repeat(…)` handed back for a detached or
 * `display: none` element, or by a test DOM with no layout) is not a count.
 */
export function gridTrackCount(template: string): number | null {
  const tracks = template.trim().split(/\s+/);
  return tracks.every((t) => /^\d+(\.\d+)?px$/.test(t)) ? tracks.length : null;
}

/**
 * Live column count of a CSS grid, read back from the browser. `null` until
 * the element mounts, and wherever the browser has no layout to report.
 *
 * Reading the rendered tracks rather than re-deriving them from the width
 * keeps the CSS the only place the column math lives: the breakpoints, rem
 * size, gap and per-variant minimums all land in the count without a JS
 * mirror to drift (lib/grid-zoom.ts documents what that drift cost the card
 * grids). The ResizeObserver catches every way the count changes: viewport
 * resize, rotation, browser zoom, a sidebar opening, a type-size change.
 *
 * Returns a callback ref so it survives the grid remounting, e.g. a collapsed
 * section expanding again. The first measure runs in the commit phase, so the
 * corrected render lands before the browser paints.
 */
export function useGridColumns<T extends HTMLElement>() {
  const [cols, setCols] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const n = gridTrackCount(getComputedStyle(el).gridTemplateColumns);
      // Keep the last good count through a transient unmeasurable frame.
      if (n !== null) setCols(n);
    };
    measure();
    // happy-dom (the test env) has no ResizeObserver; the one-shot measure
    // above is enough there.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, cols] as const;
}
