import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../shared/Button';
import { DiscoverDeckTile, DiscoverTileSkeleton } from '../DiscoverDeckTile';
// The rail header borrows HomeCard's header/view-all family. HomePage is lazy,
// so this chunk (main) has to load the stylesheet itself.
import '../home/HomeCard.css';
import { listDiscoverDecks, type DiscoverDeck } from '../../lib/discover-client';

/** Below this many fresh decks, the rail renders nothing rather than a
 *  near-empty grid on the marketing page a cold visitor and search crawlers
 *  land on — same ghost-town-proofing instinct as PublicProfilePage's
 *  GHOST_TOWN_THRESHOLD, applied to a rail's visibility instead of a stat
 *  line's. */
const MIN_DECKS_TO_SHOW = 3;
/** A rail, not the whole first Discover page: the skeleton below reserves
 *  exactly this many tiles, so the feature grid under it doesn't jump when
 *  the real tiles land (the landing's one large layout shift). */
const RAIL_SIZE = 6;

/**
 * "Fresh public decks" — the welcome storefront's first live rail (pass 2c).
 * First page of `listDiscoverDecks({sort:'newest'})`, rendered with the exact
 * same `DiscoverDeckTile` grid `/decks/discover` uses — guest-safe by
 * construction: `DiscoverDeckTile`'s Like/Bookmark buttons already handle a
 * signed-out viewer, and the server never returns personal data to a guest.
 * Renders nothing until the fetch resolves with at least
 * `MIN_DECKS_TO_SHOW` decks. It stays absent — no loading skeleton or error
 * banner, which would read as a broken half-shell on a marketing page —
 * identical to the too-few-decks case, and reappears once real data lands.
 *
 * `onVisibilityChange` reports whether the rail decided to show anything
 * (called once real data has resolved), so a caller can decide whether a
 * sibling rail is also worth mounting rather than stacking two half-empty
 * marketing sections (B1-06 — see WelcomePage's use of it with TrendingRail).
 */
export function FreshDecksRail({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
} = {}) {
  // null = still loading (skeleton); [] = resolved with nothing / failed.
  const [decks, setDecks] = useState<DiscoverDeck[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks({ sort: 'newest' })
      .then((res) => {
        if (!cancelled) setDecks(res.decks);
      })
      .catch(() => {
        // Silent — see doc comment above. Nothing to recover into; an empty
        // resolution collapses the rail exactly like the too-few case.
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (decks) onVisibilityChange?.(decks.length >= MIN_DECKS_TO_SHOW);
  }, [decks, onVisibilityChange]);

  if (decks === null) {
    return (
      <section className="welcome-fresh-rail" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          Loading public decks…
        </p>
        <ul className="decks-index-list is-grid" aria-hidden="true">
          {Array.from({ length: RAIL_SIZE }, (_, i) => (
            <DiscoverTileSkeleton key={i} view="grid" />
          ))}
        </ul>
      </section>
    );
  }
  if (decks.length < MIN_DECKS_TO_SHOW) return null;

  return (
    <section className="welcome-fresh-rail" aria-labelledby="welcome-fresh-decks-heading">
      <div className="home-card-header">
        <h2 id="welcome-fresh-decks-heading" className="deck-combos-title">
          Fresh public decks
        </h2>
        <Button
          variant="link"
          to="/decks/discover"
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          View all
        </Button>
      </div>
      <ul className="decks-index-list is-grid" aria-label="Recently published public decks">
        {decks.slice(0, RAIL_SIZE).map((deck) => (
          <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" />
        ))}
      </ul>
    </section>
  );
}
