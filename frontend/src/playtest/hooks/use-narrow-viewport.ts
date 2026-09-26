import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport matches the playtest mobile layout breakpoint
 * (≤1023px). MUST agree with playtest.css's `@media (max-width: 1023px)`
 * tier: at exactly 1024px the old ≤1024 default unmounted the desktop piles
 * (JS said narrow) while the CSS still hid the Zones tab (CSS said desktop),
 * so an iPad-landscape board had no way to reach any zone.
 */
/**
 * The phone boundary, as opposed to the tier boundary above. The board's
 * layout is the same at every width; this is the one question that is not —
 * whether four card-width zone piles fit along the bottom beside the hand.
 * MUST agree with playtest.css's phone block, which sizes the same split.
 */
export const PHONE_MAX_WIDTH = 767;

/** A phone on its side: 800 to 930px wide, so the width test above misses
 *  it, but a table under 500px tall has no room for four piles either. 500
 *  clears the tallest phones (about 430px) and stays under every tablet.
 *  RotatePrompt and the opening hand use the same line. */
export const SHORT_LANDSCAPE_QUERY = '(max-height: 500px) and (orientation: landscape)';

/** Upright and narrow, or on its side. MUST agree with playtest.css's phone
 *  block. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), ${SHORT_LANDSCAPE_QUERY}`;

/** A phone held upright: the hand takes the whole bottom edge and the card
 *  preview the middle of the felt. MUST agree with playtest.css's upright
 *  block. */
export const UPRIGHT_PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px) and (orientation: portrait)`;

export function useNarrowViewport(maxWidth = 1023): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [maxWidth]);

  return narrow;
}
