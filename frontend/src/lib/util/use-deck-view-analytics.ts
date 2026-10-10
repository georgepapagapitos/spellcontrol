import { useEffect, useRef, type RefObject } from 'react';
import { track, type EventName } from './analytics';

const VIEW_EVENTS: Partial<Record<string, EventName>> = {
  power: 'deck_power_viewed',
  tune: 'deck_coach_viewed',
};

/**
 * Usage counters for a deck page's views. A pageview keys on the path alone,
 * so the Power and Coach tabs (`?view=`) and the stats under the list never
 * showed up in Admin → Analytics; these count how often each is seen. The
 * path is the deck page's own (`/decks/:id` in the editor, `/d/:id` on a
 * shared deck), so owner and visitor counts stay apart.
 */
export function useDeckViewAnalytics(
  view: string,
  statsHeadingRef: RefObject<Element | null>
): void {
  useEffect(() => {
    const name = VIEW_EVENTS[view];
    if (name) track(name);
  }, [view]);

  // Stats count once per page, when the heading is on screen. Reaching the
  // Deck tab isn't the same as reading the stats: they sit under the list.
  const seen = useRef(false);
  useEffect(() => {
    const el = statsHeadingRef.current;
    if (!el || seen.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (seen.current || !entries.some((e) => e.isIntersecting)) return;
        seen.current = true;
        track('deck_stats_viewed');
        io.disconnect();
      },
      { threshold: 1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [statsHeadingRef, view]);
}
