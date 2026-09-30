import './SavedDecksPage.css';
// The error/retry row is Discover's (.discover-decks-error*) — this page is
// its own lazy chunk, so it loads that stylesheet itself.
import './DiscoverDecksPage.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DecksHubTabs } from '@/components/decks/DecksHubTabs';
import { PageHeader } from '@/components/app-shell/PageHeader';
import {
  DiscoverDeckTile,
  DiscoverTileSkeleton,
  DISCOVER_SKELETON_COUNT,
} from '@/components/decks/DiscoverDeckTile';
import { useAuth } from '../store/auth';
import { listBookmarkedDecks, type DiscoverDeck } from '@/lib/discover/discover-client';
import { EmptyState } from '../components/shared/EmptyState';

import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
/**
 * /decks/saved — the caller's own bookmarked decks (w2-likes-bookmarks). No
 * filters/sort/pagination, matching the backend's own no-pagination call for
 * a personal-list scale. Renders the identical DiscoverDeckTile grid — the
 * shape is guaranteed identical to Discover's own listing (both go through
 * hydratePublicationRows) — with every tile's BookmarkButton pre-set
 * bookmarked=true so unsaving works directly from this list.
 */
export function SavedDecksPage() {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [decks, setDecks] = useState<DiscoverDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Imperative reload for the Retry button — mirrors DiscoverDecksPage's own
  // mount-effect/imperative-reload split (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listBookmarkedDecks()
      .then(setDecks)
      .catch((err: unknown) => {
        setError(userMessage(err, "Couldn't load your saved decks."));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Nothing to fetch for a guest — and nothing to do to `loading` either:
    // the render below checks `!isAuthed` before `loading`, so the initial
    // `loading=true` is simply never reached for a guest (react-hooks/
    // set-state-in-effect: no synchronous setState belongs in this branch).
    if (!isAuthed) return;
    let cancelled = false;
    listBookmarkedDecks()
      .then((res) => {
        if (!cancelled) setDecks(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(userMessage(err, "Couldn't load your saved decks."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const handleUnsaved = useCallback((slug: string) => {
    setDecks((prev) => prev.filter((d) => d.slug !== slug));
  }, []);

  return (
    <>
      <div className="decks-index-page">
        <PageHeader title="Saved" />
        <DecksHubTabs />

        {!isAuthed ? (
          <EmptyState
            tagline="Saved decks need an account."
            hint="Sign in to bookmark decks from Discover and find them here later."
            actions={
              <Button variant="primary" to={`/auth?returnTo=${encodeURIComponent('/decks/saved')}`}>
                Sign in
              </Button>
            }
          />
        ) : loading ? (
          <>
            <p role="status" aria-live="polite" className="sr-only">
              Loading your saved decks…
            </p>
            <ul className="decks-index-list is-grid" aria-hidden="true">
              {Array.from({ length: DISCOVER_SKELETON_COUNT }, (_, i) => (
                <DiscoverTileSkeleton key={i} view="grid" />
              ))}
            </ul>
          </>
        ) : error ? (
          <div className="discover-decks-error" role="alert">
            <span>{error}</span>
            <Button onClick={load} className="discover-decks-error-retry">
              Retry
            </Button>
          </div>
        ) : decks.length === 0 ? (
          <EmptyState
            tagline="Nothing saved yet."
            hint={
              <>
                Bookmark a deck from <Link to="/decks/discover">Discover</Link> to find it here
                later.
              </>
            }
          />
        ) : (
          <ul className="decks-index-list is-grid" aria-label="Saved decks">
            {decks.map((deck) => (
              <DiscoverDeckTile key={deck.slug} deck={deck} view="grid" onUnsaved={handleUnsaved} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
