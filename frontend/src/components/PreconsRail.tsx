import { useMemo } from 'react';
import { DiscoverDeckRail } from './DiscoverDeckRail';
import { discoverFiltersToSearchParams, type DiscoverFilters } from '../lib/discover-filters';

/**
 * Every Commander precon, published by the SpellControl house account. A
 * shelf of its own: precons never enter the community grid or its rankings
 * (routes/discover.ts), so this rail is the way in.
 *
 * Given the page's filters it narrows with them, so a Discover search for a
 * commander also turns up that commander's precons, and "View all" carries
 * the same search across. A filter nothing matches hides the rail.
 */
export function PreconsRail({ filters }: { filters?: DiscoverFilters }) {
  const query = useMemo(
    () => ({ sort: 'newest' as const, source: 'precons' as const, ...filters }),
    [filters]
  );
  const viewAllTo = useMemo(() => {
    const params = filters ? discoverFiltersToSearchParams(filters) : new URLSearchParams();
    params.set('source', 'precons');
    return `/decks/discover?${params.toString()}`;
  }, [filters]);
  return (
    <DiscoverDeckRail
      query={query}
      heading="Precons"
      viewAllTo={viewAllTo}
      listLabel="Commander precons"
      loadingLabel="Loading precons…"
    />
  );
}
