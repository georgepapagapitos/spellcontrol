import './DiscoverDeckRail.css';
import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from './shared/Button';
import { DiscoverDeckTile, DiscoverTileSkeleton } from './DiscoverDeckTile';
// The rail header borrows HomeCard's header/view-all family. HomePage is lazy,
// so a rail on the welcome page (main chunk) has to load the stylesheet itself.
import './home/HomeCard.css';
import { listDiscoverDecks, type DiscoverDeck } from '../lib/discover-client';
import { SwipeRow } from './shared/SwipeRow';

type RailQuery = Parameters<typeof listDiscoverDecks>[0];

interface Props {
  query: RailQuery;
  heading: string;
  /** Where "View all" goes. */
  viewAllTo: string;
  /** The tile row's accessible name. */
  listLabel: string;
  /** Read out while the first page loads. */
  loadingLabel: string;
  /** Below this many decks the rail renders nothing (see FreshDecksRail). */
  minToShow?: number;
  /** Tiles shown, and tiles the skeleton reserves so nothing under it jumps. */
  size?: number;
  /** Reports once the fetch settles whether the rail showed anything. */
  onVisibilityChange?: (visible: boolean) => void;
}

/**
 * A titled row of public deck tiles with a "View all" link: the first page of
 * one Discover query, rendered with the same `DiscoverDeckTile` the Discover
 * grid uses. Guest-safe by construction (the tile's Like/Bookmark handle a
 * signed-out viewer, and the listing carries no personal data).
 *
 * While loading it reserves its tiles with skeletons. Once settled it renders
 * nothing when there are too few decks or the fetch failed: a rail is a bonus
 * on its page, never an error banner or an empty shell.
 */
export function DiscoverDeckRail({
  query,
  heading,
  viewAllTo,
  listLabel,
  loadingLabel,
  minToShow = 1,
  size = 6,
  onVisibilityChange,
}: Props) {
  const headingId = useId();
  // null = still loading (skeleton); [] = resolved with nothing / failed.
  const [decks, setDecks] = useState<DiscoverDeck[] | null>(null);
  // The query arrives as a fresh object each render; refetch on its content.
  const queryKey = JSON.stringify(query);

  // Render-phase reset when the query changes, so a new search shows the
  // skeleton rather than the previous query's tiles.
  const [prevKey, setPrevKey] = useState(queryKey);
  if (prevKey !== queryKey) {
    setPrevKey(queryKey);
    setDecks(null);
  }

  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks(JSON.parse(queryKey) as RailQuery)
      .then((res) => {
        if (!cancelled) setDecks(res.decks);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  useEffect(() => {
    if (decks) onVisibilityChange?.(decks.length >= minToShow);
  }, [decks, minToShow, onVisibilityChange]);

  if (decks === null) {
    return (
      <section className="discover-deck-rail" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {loadingLabel}
        </p>
        <SwipeRow className="decks-index-list is-grid" columns={size} aria-hidden="true">
          {Array.from({ length: size }, (_, i) => (
            <DiscoverTileSkeleton key={i} view="grid" />
          ))}
        </SwipeRow>
      </section>
    );
  }
  if (decks.length < minToShow) return null;

  return (
    <section className="discover-deck-rail" aria-labelledby={headingId}>
      <div className="home-card-header">
        <h2 id={headingId} className="deck-combos-title">
          {heading}
        </h2>
        <Button
          variant="link"
          to={viewAllTo}
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          View all
        </Button>
      </div>
      <SwipeRow className="decks-index-list is-grid" columns={size} aria-label={listLabel}>
        {decks.slice(0, size).map((deck) => (
          <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" />
        ))}
      </SwipeRow>
    </section>
  );
}
