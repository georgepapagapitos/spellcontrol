import './ActivityStripCard.css';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Heart, MessageSquare, Share2, UserPlus } from 'lucide-react';
import { HomeCard } from './HomeCard';
import { useActivity } from '../../lib/use-activity';
import { useAuth } from '../../store/auth';
import { formatIdentity } from '../../lib/display-name';
import { formatRelativeTime } from '../../lib/format-time';
import type { RecentActivityItem } from '../../lib/activity-client';

const ROW_ICON_PROPS = { width: 14, height: 14, strokeWidth: 1.8, 'aria-hidden': true } as const;

interface RecentRow {
  id: string;
  to: string;
  icon: ReactNode;
  ariaLabel: string;
  text: ReactNode;
  time: string;
}

/**
 * Per-`RecentActivityItem`-variant row content. Only the three real variants
 * `w2-activity-feed` ships (`direct_share` | `feedback` | `deck_liked`) —
 * the bucket-spec draft this PR was written against also described a
 * `deck_copied` variant that doesn't exist in the shipped `ActivityItem`
 * union (`lib/activity-client.ts`), so it's omitted rather than handled dead.
 */
function recentRow(item: RecentActivityItem): RecentRow {
  const time = formatRelativeTime(item.occurredAt);
  switch (item.type) {
    case 'direct_share': {
      // Mid-sentence prose — primary name only, no secondary handle (same
      // convention as FriendsManagement's own inbox row for this exact
      // fromUsername/fromDisplayName pair).
      const fromName = formatIdentity({
        username: item.fromUsername,
        displayName: item.fromDisplayName,
      }).primary;
      return {
        id: item.id,
        to: `/s/${item.token}`,
        icon: <Share2 {...ROW_ICON_PROPS} className="activity-strip-icon" />,
        ariaLabel: `${fromName} shared a ${item.kind}: ${item.label}, ${time}`,
        text: (
          <>
            <span className="activity-strip-name">{fromName}</span> shared a {item.kind}:{' '}
            <span className="activity-strip-target">{item.label}</span>
          </>
        ),
        time,
      };
    }
    case 'feedback':
      return {
        id: item.id,
        to: `/decks/${item.deckId}`,
        icon: <MessageSquare {...ROW_ICON_PROPS} className="activity-strip-icon" />,
        ariaLabel: `${item.authorName} left feedback on ${item.deckName}, ${time}`,
        text: (
          <>
            <span className="activity-strip-name">{item.authorName}</span> left feedback on{' '}
            <span className="activity-strip-target">{item.deckName}</span>
          </>
        ),
        time,
      };
    case 'deck_liked': {
      const peopleWord = item.count === 1 ? 'person liked' : 'people liked';
      return {
        id: item.id,
        // Only a `slug` ships on this variant (not a `deckId`), so this
        // links to the public deck page rather than the owner-only editor.
        to: `/d/${item.slug}`,
        icon: <Heart {...ROW_ICON_PROPS} className="activity-strip-icon" />,
        ariaLabel: `${item.count} ${peopleWord} ${item.deckName}, ${time}`,
        text: (
          <>
            {item.count} {peopleWord} <span className="activity-strip-target">{item.deckName}</span>
          </>
        ),
        time,
      };
    }
  }
}

/**
 * Home's notifications strip (social program W3): pending friend requests +
 * the 3 most recent shares/feedback/likes, both straight from the one shared
 * `useActivity()` feed (W2) that also drives the header/nav badge. The hook
 * self-gates on auth status (guest never fetches) and swallows fetch errors
 * (keeps last-known state) — this card therefore has no error slot, only
 * loading/empty/populated.
 */
export function ActivityStripCard() {
  const status = useAuth((s) => s.status);
  const { actionRequired, recent, loading } = useActivity();
  const rows = recent.slice(0, 3).map(recentRow);
  const hasRequests = actionRequired.length > 0;
  const empty = !hasRequests && rows.length === 0;

  return (
    <HomeCard
      title="Activity"
      icon={Bell}
      loading={loading}
      empty={empty}
      emptyText={status === 'guest' ? 'Sign in to see friend activity.' : 'No new activity.'}
      // The sign-in door is guest-irrelevant (the hero already carries
      // sign-in) — only offered for an authed-but-empty feed.
      viewAllHref={empty && status !== 'guest' ? '/you?friendsTab=friends' : undefined}
      viewAllLabel="Find friends"
    >
      <ul className="activity-strip-list" aria-label="Recent activity">
        {hasRequests && (
          <li className="activity-strip-item">
            <Link
              to="/you?friendsTab=requests"
              className="activity-strip-link is-request"
              aria-label={`${actionRequired.length} friend request${
                actionRequired.length === 1 ? '' : 's'
              } waiting`}
            >
              <UserPlus {...ROW_ICON_PROPS} className="activity-strip-icon" />
              <span className="activity-strip-text">
                {actionRequired.length} friend request{actionRequired.length === 1 ? '' : 's'}{' '}
                waiting
              </span>
            </Link>
          </li>
        )}
        {rows.map((row) => (
          <li key={row.id} className="activity-strip-item">
            <Link to={row.to} className="activity-strip-link" aria-label={row.ariaLabel}>
              {row.icon}
              <span className="activity-strip-text">{row.text}</span>
              <span className="activity-strip-time">{row.time}</span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
