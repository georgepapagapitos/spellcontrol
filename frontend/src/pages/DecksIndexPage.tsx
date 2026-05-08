import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { formatRelativeTime } from '../lib/format-time';

export function DecksIndexPage() {
  const decks = useDecksStore((s) => s.decks);
  const sorted = useMemo(() => [...decks].sort((a, b) => b.updatedAt - a.updatedAt), [decks]);

  return (
    <div className="decks-index-page">
      <header className="decks-index-header">
        <div>
          <h1>Decks</h1>
          <p className="decks-index-subtitle">
            Saved Commander decks. Build a new one from a commander, generate from EDHREC, or start
            blank and add cards from your collection.
          </p>
        </div>
        <Link to="/decks/new" className="btn btn-primary">
          New deck
        </Link>
      </header>

      {sorted.length === 0 ? (
        <div className="decks-index-empty">
          <p>No decks yet.</p>
          <Link to="/decks/new" className="btn btn-primary">
            Build your first deck
          </Link>
        </div>
      ) : (
        <ul className="decks-index-list">
          {sorted.map((deck) => {
            const totalCards =
              (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length;
            const art =
              deck.commander?.image_uris?.art_crop ??
              deck.commander?.card_faces?.[0]?.image_uris?.art_crop;
            return (
              <li key={deck.id} className="decks-index-card">
                <Link to={`/decks/${deck.id}`} className="decks-index-card-link">
                  {art && (
                    <img className="decks-index-card-art" src={art} alt="" aria-hidden="true" />
                  )}
                  <div className="decks-index-card-body">
                    <div className="decks-index-card-name">{deck.name}</div>
                    <div className="decks-index-card-meta">
                      {deck.commander?.name ?? 'No commander'} · {totalCards} cards ·{' '}
                      {deck.source === 'generated' ? 'Generated' : 'Manual'}
                    </div>
                    <div className="decks-index-card-time">
                      Edited {formatRelativeTime(deck.updatedAt)}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
