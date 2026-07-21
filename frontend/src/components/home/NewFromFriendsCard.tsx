import './NewFromFriendsCard.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Share2, UserPlus } from 'lucide-react';
import { HomeCard } from './HomeCard';
import { UserAvatar } from '../UserAvatar';
import { useAuth } from '../../store/auth';
import { getFriendsActivity, type FriendActivityItem } from '../../lib/friends-client';
import { formatRelativeTime } from '../../lib/format-time';

const ROW_ICON_PROPS = { width: 11, height: 11, strokeWidth: 2.2, 'aria-hidden': true } as const;

function rowKey(item: FriendActivityItem): string {
  return item.type === 'published_deck' ? `pub:${item.slug}` : `share:${item.token}`;
}

function rowHref(item: FriendActivityItem): string {
  return item.type === 'published_deck' ? `/d/${item.slug}` : `/s/${item.token}`;
}

/**
 * Home's new-from-friends rail (social program W3): the first 3 entries of
 * `w2-friends-activity-feed`'s aggregated feed — a friend publishing a deck,
 * or sharing something with their friends audience. No `viewAllHref`: the
 * only other place this feed renders is `/you`'s Friends > Activity tab,
 * not worth a second hop for 3 rows.
 */
export function NewFromFriendsCard() {
  const status = useAuth((s) => s.status);
  const guest = status === 'guest';
  const [items, setItems] = useState<FriendActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No synchronous setState in its own body (only inside .then/.catch) — safe
  // to call directly from the mount effect below (react-hooks/set-state-in-effect
  // only flags a *synchronous* setState reachable from an effect's own call
  // stack; same shape as DiscoverDecksPage's mount-fetch effect).
  const fetchActivity = useCallback(() => {
    getFriendsActivity()
      .then((result) => setItems(result))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load activity.');
      });
  }, []);

  useEffect(() => {
    if (guest) return;
    fetchActivity();
  }, [guest, fetchActivity]);

  // Retry is an event handler, not an effect — a synchronous setState here is
  // unproblematic (same distinction DiscoverDecksPage's loadFirstPage draws).
  const handleRetry = useCallback(() => {
    setError(null);
    fetchActivity();
  }, [fetchActivity]);

  const rows = (items ?? []).slice(0, 3);
  const loading = !guest && items === null && !error;
  const empty = guest || rows.length === 0;

  return (
    <HomeCard
      title="New from friends"
      icon={UserPlus}
      loading={loading}
      error={error}
      onRetry={handleRetry}
      empty={empty}
      emptyText={
        guest ? 'Sign in to see what friends are sharing.' : 'Nothing new from friends yet.'
      }
    >
      <ul className="new-from-friends-list" aria-label="New from friends">
        {rows.map((item) => {
          const verb = item.type === 'published_deck' ? 'published' : 'shared';
          const target = item.type === 'published_deck' ? item.deckName : item.label;
          const Icon = item.type === 'published_deck' ? Layers : Share2;
          const time = formatRelativeTime(item.occurredAt);
          return (
            <li key={rowKey(item)} className="new-from-friends-item">
              <Link
                to={rowHref(item)}
                className="new-from-friends-link"
                aria-label={`${item.friendUsername} ${verb} ${target}, ${time}`}
              >
                <span className="new-from-friends-avatar-wrap">
                  <UserAvatar name={item.friendUsername} size={28} />
                  <Icon {...ROW_ICON_PROPS} className="new-from-friends-badge" />
                </span>
                <span className="new-from-friends-text">
                  <span className="new-from-friends-name">{item.friendUsername}</span> {verb}{' '}
                  <span className="new-from-friends-target">{target}</span>
                </span>
                <span className="new-from-friends-time">{time}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
