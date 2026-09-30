import './AroundTheTable.css';
import './FollowedBrewersCard.css';
import { Link } from 'react-router-dom';
import { UserCheck } from 'lucide-react';
import { HomeCard } from './HomeCard';
import { UserAvatar } from '@/components/profile/UserAvatar';
import type { FollowedDeckPublishedActivityItem } from '@/lib/social/activity-client';
import { formatIdentity } from '@/lib/social/display-name';
import { formatRelativeTime } from '@/lib/util/format-time';

const ROW_LIMIT = 4;

/**
 * New decks from brewers the viewer follows: deck name (to the deck), who
 * (to their profile), and when. It rides the activity fetch Home already
 * makes and, unlike everything in Around the table, never counts toward the
 * nav badge: a followed brewer publishing is content, not a question. Nothing
 * from anyone renders nothing (STYLE_GUIDE § Home); The two links per row (deck,
 * brewer) are separate targets, so the row is not one link.
 *
 * The timestamp reuses Around the table's `home-table-time`.
 */
export function FollowedBrewersCard({
  items,
  loading,
}: {
  items: FollowedDeckPublishedActivityItem[];
  loading: boolean;
}) {
  const rows = items.slice(0, ROW_LIMIT);
  return (
    <HomeCard
      title="New from brewers you follow"
      icon={UserCheck}
      loading={loading}
      empty={rows.length === 0}
    >
      <ul className="home-table-rows">
        {rows.map((item) => {
          const who = formatIdentity({
            username: item.brewerUsername,
            displayName: item.brewerDisplayName,
          }).primary;
          const time = formatRelativeTime(item.occurredAt);
          return (
            <li key={item.id} className="home-followed-row">
              <UserAvatar name={who} size={32} />
              <span className="home-followed-text">
                <Link to={`/d/${item.slug}`} className="home-followed-deck">
                  {item.deckName}
                </Link>
                <span className="home-followed-by">
                  by{' '}
                  <Link to={`/u/${item.brewerUsername}`} className="home-followed-brewer">
                    {who}
                  </Link>
                </span>
              </span>
              <span className="home-table-time">{time}</span>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
