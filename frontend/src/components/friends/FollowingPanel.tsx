import '@/styles/social-shared.css';
import './FollowingPanel.css';
import { Compass } from 'lucide-react';
import { BrewerCard, BrewerCardSkeleton } from '../social/BrewerCard';
import { FollowButton } from '../social/FollowButton';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import type { BrewerCard as BrewerCardData } from '@/lib/social/brewers-client';

interface Props {
  /** null until the first answer. */
  brewers: BrewerCardData[] | null;
  error: string | null;
  onRetry: () => void;
}

/**
 * Everyone you follow, newest follow first, as the brewer cards the Brewers
 * tab uses. Each row carries the Follow toggle beside its card (not inside
 * it: the card is one link to the profile), so Unfollow is one tap. Unfollowing
 * leaves the row in place as "Follow", so a mis-tap is one tap to undo; the
 * row is gone the next time the list loads.
 */
export function FollowingPanel({ brewers, error, onRetry }: Props) {
  if (error) {
    return (
      <div className="friends-error" role="alert">
        <span>{error}</span>
        <Button onClick={onRetry} className="friends-error-retry">
          Retry
        </Button>
      </div>
    );
  }
  if (brewers === null) {
    return (
      <ul className="following-list" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <BrewerCardSkeleton key={i} variant="row" />
        ))}
      </ul>
    );
  }
  if (brewers.length === 0) {
    return (
      <EmptyState
        status
        tagline="You aren't following anyone yet."
        hint="Follow brewers to see their new decks on Home."
        actions={
          <Button variant="primary" to="/decks/discover/brewers" icon={<Compass size={16} />}>
            Find brewers
          </Button>
        }
      />
    );
  }
  return (
    <ul className="following-list" aria-label="Brewers you follow">
      {brewers.map((b) => (
        <li key={b.username} className="following-item">
          <BrewerCard brewer={b} variant="row" as="div" />
          <FollowButton username={b.username} initialFollowing />
        </li>
      ))}
    </ul>
  );
}
