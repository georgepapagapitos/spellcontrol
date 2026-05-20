import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport matches the playtest mobile layout breakpoint
 * (≤1024px). Matches the deck-editor overflow-menu threshold so behavior
 * stays consistent across the app.
 */
export function useNarrowViewport(maxWidth = 1024): boolean {
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
