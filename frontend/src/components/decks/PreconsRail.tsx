import './PreconsRail.css';
// The rail header borrows HomeCard's header/view-all family.
import '@/components/home/HomeCard.css';
import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { SwipeRow } from '@/components/shared/SwipeRow';
import { DiscoverDeckTile, DiscoverTileSkeleton } from './DiscoverDeckTile';
import { listDiscoverDecks, type DiscoverDeck } from '@/lib/discover/discover-client';
import type { DiscoverFilters } from '@/lib/discover/discover-filters';

const RAIL_SIZE = 6;
const SHELF = '/decks/discover?source=precons';

/**
 * Every Commander precon, published by the SpellControl house account. A
 * shelf of its own: precons never enter the community grid or its rankings
 * (routes/discover.ts), so this rail is the way in.
 *
 * Given the page's filters it narrows with them, so a Discover search for a
 * commander also turns up that commander's precons; `viewAllTo` lets the page
 * carry the same search into the full shelf. While loading it reserves its
 * tiles; once settled it renders nothing when no precon matches or the fetch
 * failed, since a rail is a bonus on its page, never an error banner.
 *
 * Keep this module out of the entry chunk: WelcomePage (eager) imports it
 * lazily, and DiscoverDecksPage is itself lazy. With it in the entry, the lazy
 * Discover page importing it made the bundler split the deck-tile family out
 * of the entry, the same CSS bytes as three extra boot stylesheets (measured
 * +1 KB gzipped against a boot budget with about that much headroom).
 */
export function PreconsRail({
  filters,
  viewAllTo = SHELF,
}: {
  filters?: DiscoverFilters;
  viewAllTo?: string;
}) {
  const headingId = useId();
  // null = still loading (skeleton); [] = resolved with nothing / failed.
  const [decks, setDecks] = useState<DiscoverDeck[] | null>(null);
  const query = useMemo(
    () => ({ sort: 'newest' as const, source: 'precons' as const, ...filters }),
    [filters]
  );

  // Render-phase reset when the query changes, so a new search shows the
  // skeleton rather than the previous search's tiles.
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setDecks(null);
  }

  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks(query)
      .then((res) => {
        if (!cancelled) setDecks(res.decks);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (decks === null) return <PreconsRailSkeleton />;
  if (decks.length === 0) return null;

  return (
    <section className="precons-rail" aria-labelledby={headingId}>
      <div className="home-card-header">
        <h2 id={headingId} className="deck-combos-title">
          Precons
        </h2>
        <Button
          variant="link"
          to={viewAllTo}
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          View all
        </Button>
      </div>
      <SwipeRow
        className="decks-index-list is-grid"
        columns={RAIL_SIZE}
        aria-label="Commander precons"
      >
        {decks.slice(0, RAIL_SIZE).map((deck) => (
          <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" />
        ))}
      </SwipeRow>
    </section>
  );
}

/** The rail's loading state: its tiles reserved, so nothing under it jumps.
 *  WelcomePage mirrors it as its Suspense fallback (it can't import it). */
function PreconsRailSkeleton() {
  return (
    <section className="precons-rail" aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">
        Loading precons…
      </p>
      <SwipeRow className="decks-index-list is-grid" columns={RAIL_SIZE} aria-hidden="true">
        {Array.from({ length: RAIL_SIZE }, (_, i) => (
          <DiscoverTileSkeleton key={i} view="grid" />
        ))}
      </SwipeRow>
    </section>
  );
}
