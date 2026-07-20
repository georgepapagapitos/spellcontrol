import { Link } from 'react-router-dom';
import './ForkedFromBadge.css';

interface Props {
  forkedFrom: { slug: string; ownerUsername: string; deckName: string };
}

/**
 * Copy-lineage line: "Forked from {deck} by @{username}", the whole sentence
 * one focusable link to the origin deck's public page. Stamped once at copy
 * time (see copy-shared-deck.ts) and never re-resolved live — if the origin
 * is later unpublished the link 404s, the same point-in-time-snapshot
 * tradeoff already accepted for game-night RSVP display names.
 */
export function ForkedFromBadge({ forkedFrom }: Props) {
  return (
    <p className="forked-from-badge">
      <Link to={`/d/${forkedFrom.slug}`} className="forked-from-badge-link">
        Forked from {forkedFrom.deckName} by @{forkedFrom.ownerUsername}
      </Link>
    </p>
  );
}
