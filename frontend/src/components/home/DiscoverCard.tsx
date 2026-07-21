import './DiscoverCard.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { HomeCard } from './HomeCard';
import { ColorPip } from '../shared/ManaSymbol';
import { listDiscoverDecks, type DiscoverDeck } from '../../lib/discover-client';

function rowAriaLabel(deck: DiscoverDeck): string {
  const parts = [deck.name];
  if (deck.commanderName) parts.push(deck.commanderName);
  parts.push(`by @${deck.ownerUsername}`);
  return parts.join(', ');
}

/**
 * Home's discover rail (social program W3): the 5 newest public decks from
 * `w2-discover-listing-api`. Unlike the other two Home cards, this one
 * renders identically for guests — `GET /api/discover/decks` needs no auth,
 * matching Discover's own logged-out-reachable posture.
 */
export function DiscoverCard() {
  const [decks, setDecks] = useState<DiscoverDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No synchronous setState in its own body (only inside .then/.catch) — safe
  // to call directly from the mount effect below (react-hooks/set-state-in-effect
  // only flags a *synchronous* setState reachable from an effect's own call
  // stack; same shape as DiscoverDecksPage's mount-fetch effect).
  const fetchDecks = useCallback(() => {
    listDiscoverDecks({ sort: 'newest', page: 1 })
      .then((result) => setDecks(result.decks))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load public decks.');
      });
  }, []);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  // Retry is an event handler, not an effect — a synchronous setState here is
  // unproblematic (same distinction DiscoverDecksPage's loadFirstPage draws).
  const handleRetry = useCallback(() => {
    setError(null);
    fetchDecks();
  }, [fetchDecks]);

  const rows = (decks ?? []).slice(0, 5);
  const loading = decks === null && !error;

  return (
    <HomeCard
      title="Discover"
      icon={Compass}
      loading={loading}
      error={error}
      onRetry={handleRetry}
      empty={rows.length === 0}
      emptyText="No public decks yet."
      viewAllHref="/decks/discover"
    >
      <ul className="discover-card-list" aria-label="New public decks">
        {rows.map((deck) => (
          <li key={deck.slug} className="discover-card-item">
            <Link
              to={`/d/${deck.slug}`}
              className="discover-card-link"
              aria-label={rowAriaLabel(deck)}
            >
              <div className="discover-card-info">
                <div className="discover-card-name-row">
                  <span className="discover-card-name">{deck.name}</span>
                  {deck.colorIdentity.length > 0 && (
                    <span className="discover-card-pips">
                      {deck.colorIdentity.map((c) => (
                        <ColorPip key={c} color={c} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="discover-card-meta">
                  {deck.commanderName && (
                    <span className="discover-card-commander">{deck.commanderName}</span>
                  )}
                  <span className="discover-card-owner">@{deck.ownerUsername}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
