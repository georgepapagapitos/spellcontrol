import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Compass } from 'lucide-react';
import { DiscoverDeckTile } from '../DiscoverDeckTile';
import { listDiscoverDecks, type DiscoverDeck } from '../../lib/discover-client';
import { userMessage } from '@/lib/user-error';
import { HomeSectionSearch } from './HomeSectionSearch';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { SectionHeader } from '@/components/shared/SectionHeader';

const ROW_LIMIT = 5;

/**
 * New public decks from other players, as the same tiles the Discover page
 * uses. `exclude: 'mine'` is the point: new decks default to public, so the
 * newest listings were mostly the viewer's own and this row repeated Your
 * decks beside it. A guest sends it too; the server ignores it for them.
 *
 * Nothing public from anyone else yet reads as one quiet line with the door
 * to browse — it is a way out to the gallery, not an insight, so it keeps a
 * line rather than vanishing.
 */
export function DiscoverRow() {
  const [decks, setDecks] = useState<DiscoverDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDecks = useCallback(() => {
    listDiscoverDecks({ sort: 'newest', page: 1, exclude: 'mine' })
      .then((result) => setDecks(result.decks.slice(0, ROW_LIMIT)))
      .catch((err: unknown) => {
        setError(
          userMessage(err, "Couldn't load public decks. Check your connection and try again.")
        );
      });
  }, []);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  const retry = useCallback(() => {
    setError(null);
    fetchDecks();
  }, [fetchDecks]);

  const loading = decks === null && !error;

  return (
    <section className="home-section" aria-labelledby="home-discover">
      <SectionHeader
        title="Discover"
        id="home-discover"
        className="home-section-head"
        titleClassName="home-section-title"
        meta={<span className="home-section-meta">New decks from other players</span>}
        toolsClassName="home-section-tools"
        tools={
          <>
            <HomeSectionSearch
              label="Search public decks"
              toResults={(term) => `/decks/discover?q=${encodeURIComponent(term)}`}
              toPage="/decks/discover"
            />
            <Link to="/decks/discover" className="home-door">
              Browse
              <ChevronRight width={14} height={14} strokeWidth={2} aria-hidden />
            </Link>
          </>
        }
      />
      {loading ? (
        <div role="status" aria-label="Loading" aria-busy="true">
          <ul className="decks-index-list is-grid home-rail" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <Surface
                as="li"
                variant="sleeve"
                key={i}
                className="decks-index-card home-tile-skeleton"
                aria-hidden="true"
              >
                <span className="home-tile-skeleton-art" />
                <span className="home-tile-skeleton-bar" />
                <span className="home-tile-skeleton-bar" />
              </Surface>
            ))}
          </ul>
        </div>
      ) : error ? (
        <div className="home-quiet" role="alert">
          <span className="home-quiet-text">{error}</span>
          <Button aria-label="Retry loading Discover" onClick={retry} className="home-card-retry">
            Retry
          </Button>
        </div>
      ) : decks && decks.length > 0 ? (
        <ul className="decks-index-list is-grid home-rail">
          {decks.map((deck) => (
            <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" />
          ))}
        </ul>
      ) : (
        <div className="home-quiet">
          <Compass width={16} height={16} strokeWidth={1.8} aria-hidden />
          <span className="home-quiet-text">No public decks from other players yet.</span>
        </div>
      )}
    </section>
  );
}
