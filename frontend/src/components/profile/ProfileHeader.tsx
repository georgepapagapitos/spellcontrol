import { useState } from 'react';
import { Users } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { Button } from '../shared/Button';
import { Chip } from '../shared/Chip';
import { FollowButton } from '../social/FollowButton';
import { formatCount } from '@/lib/util/format-count';
import { formatSocialCount } from '@/lib/social/social-proof';
import type { PublicProfile } from '@/lib/social/profile-client';
import './ProfileHeader.css';

/**
 * The banner's art, in the order the style guide rules: the pinned deck's art,
 * else the top commander's, else none. No banner at all beats an empty box.
 */
function profileBannerImage(profile: PublicProfile): string | null {
  const pinned = profile.pinnedDeckSlug
    ? profile.decks.find((d) => d.slug === profile.pinnedDeckSlug)
    : undefined;
  return pinned?.commanderImage ?? profile.topCommanders[0]?.image ?? null;
}

/**
 * `size={72}` (≤600px) / `96` (601–1023px) / `128` (≥1024px) — three fixed
 * instances toggled by CSS `display`, not a resize-driven re-render (`UserAvatar`
 * bakes `size` into inline styles, so only a discrete swap can vary it via CSS).
 */
function ResponsiveAvatar({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  return (
    <>
      <span className="public-profile-avatar public-profile-avatar-sm">
        <UserAvatar imageUrl={imageUrl} name={name} size={72} />
      </span>
      <span className="public-profile-avatar public-profile-avatar-md">
        <UserAvatar imageUrl={imageUrl} name={name} size={96} />
      </span>
      <span className="public-profile-avatar public-profile-avatar-lg">
        <UserAvatar imageUrl={imageUrl} name={name} size={128} />
      </span>
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * People counts, never clicks. Decks, followers and following are plain
 * counts; likes and copies stay under the shared social-proof floor so a brand
 * new brewer never reads "0 likes".
 */
function StatLine({ profile, followerCount }: { profile: PublicProfile; followerCount: number }) {
  const likes = formatSocialCount(profile.stats.likesReceived);
  const copies = formatSocialCount(profile.stats.copiesReceived);
  const items: { key: string; value: string; label: string }[] = [
    {
      key: 'decks',
      value: formatCount(profile.deckCount),
      label: plural(profile.deckCount, 'deck', 'decks'),
    },
    {
      key: 'followers',
      value: formatCount(followerCount),
      label: plural(followerCount, 'follower', 'followers'),
    },
    { key: 'following', value: formatCount(profile.followingCount), label: 'following' },
  ];
  if (likes) {
    items.push({
      key: 'likes',
      value: likes,
      label: plural(profile.stats.likesReceived, 'like', 'likes'),
    });
  }
  if (copies) {
    items.push({
      key: 'copies',
      value: copies,
      label: plural(profile.stats.copiesReceived, 'copy', 'copies'),
    });
  }
  return (
    <ul className="profile-stat-line" aria-label="Profile stats">
      {items.map((item) => (
        <li key={item.key}>
          <strong>{item.value}</strong> {item.label}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  profile: PublicProfile;
  /** displayName-or-@username. */
  heading: string;
  handle: string | null;
  joined: string;
  onReport: () => void;
}

/**
 * Banner, avatar, identity, follow and the stat line. A moderator-hidden
 * profile gets the identity alone: no banner art, follow or numbers from a
 * profile that is off the public surface.
 */
export function ProfileHeader({ profile, heading, handle, joined, onReport }: Props) {
  const [followerCount, setFollowerCount] = useState(profile.followerCount);
  const hidden = profile.moderationHidden;
  const banner = hidden ? null : profileBannerImage(profile);
  const canFollow = !hidden && !profile.isOwner;

  return (
    <header className={`public-profile-header${banner ? ' has-banner' : ''}`}>
      {banner && (
        <span className="public-profile-banner" aria-hidden="true">
          <img src={banner} alt="" loading="lazy" />
        </span>
      )}
      <div className="public-profile-header-row">
        <ResponsiveAvatar imageUrl={profile.avatarImageUrl} name={heading} />
        <div className="public-profile-header-text">
          <h1 className="public-profile-name">{heading}</h1>
          {handle && <p className="public-profile-handle">{handle}</p>}
          {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}
          {!hidden && <StatLine profile={profile} followerCount={followerCount} />}
          {profile.isOfficial ? (
            // The house account: nobody's member, and nothing to report or
            // edit. Its line says what it is and opens the full shelf, which
            // has the search and filters this page doesn't.
            <p className="public-profile-joined">
              Official account{' · '}
              <Button
                variant="link"
                to="/decks/discover?source=precons"
                className="public-profile-report-btn"
              >
                Browse all {profile.deckCount} precons
              </Button>
            </p>
          ) : (
            <p className="public-profile-joined">
              Joined {joined}
              {' · '}
              {profile.isOwner ? (
                // Your own profile: the way back to the editor on /you replaces
                // Report (nobody reports themselves).
                <Button variant="link" to="/you/profile" className="public-profile-report-btn">
                  Edit profile
                </Button>
              ) : (
                <Button
                  variant="link"
                  aria-label="Report this profile"
                  onClick={onReport}
                  className="public-profile-report-btn"
                >
                  Report
                </Button>
              )}
            </p>
          )}
          {canFollow && (
            <div className="public-profile-actions">
              <FollowButton
                username={profile.username}
                initialFollowing={profile.viewerFollows}
                onChange={(_following, count) => setFollowerCount(count)}
              />
              {profile.viewerIsFriend && (
                <Chip
                  className="public-profile-friend-chip"
                  icon={<Users width={14} height={14} strokeWidth={1.8} />}
                >
                  Friends
                </Chip>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
