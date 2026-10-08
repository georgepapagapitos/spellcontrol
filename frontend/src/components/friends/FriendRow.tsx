import './FriendRow.css';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Handshake, UserRound, UserMinus } from 'lucide-react';
import { OverflowMenu } from '@/components/overlays/OverflowMenu';
import { UserAvatar } from '@/components/profile/UserAvatar';
import { ColorIdentityBar } from '../shared/ColorIdentityBar';
import { Surface } from '../shared/Surface';
import type { Friend } from '@/lib/social/friends-client';
import { formatIdentity } from '@/lib/social/display-name';
import { formatRelativeTime } from '@/lib/util/format-time';
import { friendPeekLine } from '@/lib/social/friend-peek';

interface Props {
  friend: Friend;
  busy: boolean;
  onRemove: (friend: Friend) => void;
}

/**
 * One friend as a person: avatar, name, a peek at what they brew (deck count,
 * top commander, colour bar, the art of a deck), and when you became friends.
 * The whole identity is one link to their profile. Everything else lives in a
 * ⋮ menu beside it, kept out of the link: Start a trade, View profile, the friend hub (trades,
 * head-to-head, what they shared with you), and Remove, which is danger-toned
 * and asks first. Remove is deliberately not a button on the row.
 */
export function FriendRow({ friend, busy, onRemove }: Props) {
  const navigate = useNavigate();
  const { primary, secondary } = formatIdentity(friend);
  const peek = friendPeekLine(friend);
  const label = [primary, secondary, peek, `Friends since ${formatRelativeTime(friend.friendedAt)}`]
    .filter(Boolean)
    .join(', ');

  return (
    <Surface as="li" variant="sleeve" className="friend-row">
      <Link to={`/u/${friend.username}`} className="friend-row-link" aria-label={label}>
        <UserAvatar imageUrl={friend.avatarImageUrl} name={primary} size={48} />
        <span className="friend-row-body">
          <span className="friend-row-name" title={primary}>
            {primary}
          </span>
          {secondary && <span className="friend-row-handle">{secondary}</span>}
          <span className="friend-row-peek">{peek}</span>
          <span className="friend-row-since">
            Friends since {formatRelativeTime(friend.friendedAt)}
          </span>
        </span>
        {friend.bannerImage && (
          <span className="friend-row-art" aria-hidden="true">
            <img src={friend.bannerImage} alt="" loading="lazy" />
            <ColorIdentityBar colors={friend.topColors ?? []} />
          </span>
        )}
      </Link>
      <OverflowMenu
        className="friend-row-menu"
        ariaLabel={`More actions for ${primary}`}
        items={[
          {
            label: 'Start a trade',
            icon: Handshake,
            onClick: () => navigate(`/friends/${friend.id}?tab=collection`),
          },
          {
            label: 'View profile',
            icon: UserRound,
            onClick: () => navigate(`/u/${friend.username}`),
          },
          {
            label: 'Trades, games and shared',
            icon: ArrowLeftRight,
            onClick: () => navigate(`/friends/${friend.id}`),
          },
          {
            label: busy ? 'Removing…' : 'Remove friend',
            icon: UserMinus,
            danger: true,
            disabled: busy,
            onClick: () => onRemove(friend),
          },
        ]}
      />
    </Surface>
  );
}

/** Fixed-geometry loading placeholder: the same box as {@link FriendRow}. */
export function FriendRowSkeleton() {
  return (
    <Surface
      as="li"
      variant="sleeve"
      className="friend-row friend-row--skeleton"
      aria-hidden="true"
    >
      <span className="friend-row-avatar-skel" />
      <span className="friend-row-body">
        <span className="friend-row-bar" />
        <span className="friend-row-bar friend-row-bar--short" />
      </span>
    </Surface>
  );
}
