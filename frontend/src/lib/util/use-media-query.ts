import { useEffect, useState } from 'react';

/**
 * Tracks a `matchMedia` query. Extracted from OpponentRail's inline listener
 * so the ticker (TableTicker.tsx) can gate on the rail's exact glance query
 * (`GLANCE_QUERY`) without duplicating the subscription plumbing — the two
 * must flip densities on the same boundary or the ticker's panel form would
 * render into a rail that's in strip form.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    // Sync once on mount: the media state can change between the initial
    // render and the listener attaching (rotation during hydration).
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}
