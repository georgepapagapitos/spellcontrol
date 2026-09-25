import { useLayoutEffect, type RefObject } from 'react';

/** Which edge(s) of a horizontal scroller have content behind them. */
export type OverflowEdges = 'none' | 'start' | 'end' | 'both';

/** The edge(s) with content past them, from the scroller's own geometry. */
export function overflowEdges(el: HTMLElement): OverflowEdges {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return 'none';
  if (el.scrollLeft <= 1) return 'end';
  return el.scrollLeft >= max - 1 ? 'start' : 'both';
}

/**
 * Publish a horizontal scroller's overflow as `data-overflow` so its
 * stylesheet can fade the edge with more behind it. A strip that hides its
 * scrollbar otherwise reads as clipped layout, not "scroll for more" (the
 * `.sc-tabs[data-overflow]` idiom). Measured on scroll and resize; the
 * attribute only changes when the state does. `key` re-binds when the
 * scroller remounts or its contents change shape.
 */
export function useOverflowEdges(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  key?: unknown
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const update = () => {
      const next = overflowEdges(el);
      if (el.dataset.overflow !== next) el.dataset.overflow = next;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [ref, enabled, key]);
}
