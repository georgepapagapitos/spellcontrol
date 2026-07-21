import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DiscoverDeckTile } from '../DiscoverDeckTile';
import { listDiscoverDecks, type DiscoverDeck } from '../../lib/discover-client';

/** Below this many fresh decks, the rail renders nothing rather than a
 *  near-empty grid on the marketing page a cold visitor and search crawlers
 *  land on — same ghost-town-proofing instinct as PublicProfilePage's
 *  GHOST_TOWN_THRESHOLD, applied to a rail's visibility instead of a stat
 *  line's. */
const MIN_DECKS_TO_SHOW = 3;

/**
 * "Fresh public decks" — the welcome storefront's first live rail (pass 2c).
 * First page of `listDiscoverDecks({sort:'newest'})`, rendered with the exact
 * same `DiscoverDeckTile` grid `/decks/discover` uses — guest-safe by
 * construction: `DiscoverDeckTile`'s Like/Bookmark buttons already handle a
 * signed-out viewer, and the server never returns personal data to a guest.
 * Renders nothing until the fetch resolves with at least
 * `MIN_DECKS_TO_SHOW` decks (a loading skeleton or an error banner would be
 * a broken-looking half-shell on a marketing page — it just stays absent,
 * identical to the too-few-decks case, and reappears once real data lands).
 */
export function FreshDecksRail() {
  const [decks, setDecks] = useState<DiscoverDeck[]>([]);

  useEffect(() => {
    let cancelled = false;
    listDiscoverDecks({ sort: 'newest' })
      .then((res) => {
        if (!cancelled) setDecks(res.decks);
      })
      .catch(() => {
        // Silent — see doc comment above. Nothing to recover into; staying
        // in the initial empty state already renders nothing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (decks.length < MIN_DECKS_TO_SHOW) return null;

  return (
    <section className="welcome-fresh-rail" aria-labelledby="welcome-fresh-decks-heading">
      <div className="home-card-header">
        <h2 id="welcome-fresh-decks-heading" className="deck-combos-title">
          Fresh public decks
        </h2>
        <Link to="/decks/discover" className="home-card-view-all">
          View all →
        </Link>
      </div>
      <ul className="decks-index-list is-grid" aria-label="Recently published public decks">
        {decks.map((deck) => (
          <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" />
        ))}
      </ul>
    </section>
  );
}
