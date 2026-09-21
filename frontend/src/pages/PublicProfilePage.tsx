import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NotFoundView, ErrorView } from '../components/share/SharedShell';
import { UserAvatar } from '../components/UserAvatar';
import { ReportDialog } from '../components/share/ReportDialog';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { formatIdentity, standaloneIdentity } from '../lib/display-name';
import { formatSocialCount } from '../lib/social-proof';
import { formatRelativeTime } from '../lib/format-time';
import {
  fetchPublicProfile,
  ProfileNotFoundError,
  ProfileRenamedError,
} from '../lib/profile-client';
import type { PublicProfile, PublicProfileDeck } from '../lib/profile-client';
import { DeckLibrary, type LibraryDeck } from '../components/decks/DeckLibrary';
import './PublicProfilePage.css';

import { userMessage } from '@/lib/user-error';
const NOT_FOUND_MESSAGE = "This profile doesn't exist or has no public decks to show.";
const SKELETON_TILE_COUNT = 6;

/** displayName-or-@username for the page heading/title — deliberately NOT
 *  `formatIdentity(...).primary` (which returns a bare, un-prefixed
 *  username): a standalone heading with no "Shared by"-style framing needs
 *  the "@" to read as a handle rather than an unset display name. */
function pageHeading(profile: Pick<PublicProfile, 'username' | 'displayName'>): {
  heading: string;
  handle: string | null;
} {
  const identity = { username: profile.username, displayName: profile.displayName };
  return {
    heading: standaloneIdentity(identity),
    handle: formatIdentity(identity).secondary,
  };
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

function ProfileSkeleton() {
  return (
    <div className="shared-view public-profile-view" aria-busy="true" aria-label="Loading profile">
      <header className="public-profile-header">
        <span className="public-profile-skeleton public-profile-skeleton-avatar" />
        <div className="public-profile-header-text">
          <span className="public-profile-skeleton public-profile-skeleton-bar public-profile-skeleton-bar--name" />
          <span className="public-profile-skeleton public-profile-skeleton-bar public-profile-skeleton-bar--handle" />
        </div>
      </header>
      <ul className="decks-index-list is-grid" aria-hidden="true">
        {Array.from({ length: SKELETON_TILE_COUNT }, (_, i) => (
          <li key={i} className="decks-index-card public-profile-skeleton-tile">
            <span className="public-profile-skeleton" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * On-art overlay line (tile system v2) — views/copies (ghost-town-
 * thresholded via the shared `formatSocialCount`, same floor as
 * `GHOST_TOWN_THRESHOLD`) plus recency. Mirrors DiscoverDeckTile's grid
 * banner overlay so the app's two art-banner tile families read
 * identically. Never empty — `formatRelativeTime` always returns something.
 *
 * Recency is the deck's last UPDATE, the same fact the shelf sorts by (the
 * server orders by updated_at, the library's sort is labelled "Updated"). It
 * used to be the publish date — a deck edited an hour ago read "4d ago" and
 * sorted under a newer publish (playtest batch 11). Discover's rail keeps
 * publishedAt on purpose: that surface is "fresh decks", and its payload
 * carries no updatedAt.
 */
function tileStatsLine(deck: PublicProfileDeck): string {
  const views = formatSocialCount(deck.viewCount);
  const copies = formatSocialCount(deck.copyCount);
  const parts = [views && `${views} views`, copies && `${copies} copies`].filter(
    (s): s is string => s != null
  );
  parts.push(formatRelativeTime(deck.updatedAt));
  return parts.join(' · ');
}

function DeckGrid({ decks, username }: { decks: PublicProfileDeck[]; username: string }) {
  // The tiles, cascade and (new) search/sort/filters all live in the shared
  // `DeckLibrary` — the same component the friend hub's Decks tab renders, so
  // a person's shelf reads identically whether you are their friend or a
  // stranger. Before this, THIS page had tiles and no controls at all, while
  // the friend hub had neither.
  const libraryDecks: LibraryDeck[] = useMemo(
    () =>
      decks.map((deck) => ({
        id: deck.slug,
        href: `/d/${deck.slug}`,
        name: deck.name,
        format: deck.format,
        commanderName: deck.commanderName,
        commanderImage: deck.commanderImage,
        colorIdentity: deck.colorIdentity,
        bracket: deck.bracket,
        updatedAt: deck.updatedAt,
        // Publication stats — this surface has them, a friend's library does not.
        statsLine: tileStatsLine(deck),
        badge: null,
      })),
    [decks]
  );

  return (
    <DeckLibrary
      decks={libraryDecks}
      ariaLabel="Public decks"
      emptyTagline="No public decks yet."
      emptyHint="Publish a deck from its share menu to feature it here."
      // Keyed per-username (a "computation identity", STYLE_GUIDE § Motion)
      // rather than a single static page key — each profile's grid is different
      // data, so browsing from one to another should cascade again.
      cascadeKey={decks.length > 0 ? `public-profile:${username}` : null}
    />
  );
}

export function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  if (!username) {
    return <NotFoundView title="Profile not found" message={NOT_FOUND_MESSAGE} />;
  }
  // Remount on username change so per-profile state is fresh and the effect runs once.
  return <PublicProfilePageInner key={username} username={username} />;
}

function PublicProfilePageInner({ username }: { username: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; profile: PublicProfile }
  >({ status: 'loading' });
  const [reporting, setReporting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchPublicProfile(username)
      .then((profile) => {
        if (!cancelled) setState({ status: 'ready', profile });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ProfileRenamedError) {
          // Replace, never push: the old handle should not sit in history as
          // a step the back button returns to.
          navigate(`/u/${err.renamedTo}`, { replace: true });
          return;
        }
        if (err instanceof ProfileNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: userMessage(err, "Couldn't load this profile. Check the link and try again."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [username, navigate]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    document.title = `${pageHeading(state.profile).heading} · SpellControl`;
  }, [state]);

  if (state.status === 'loading') {
    return <ProfileSkeleton />;
  }
  if (state.status === 'notFound') {
    return <NotFoundView title="Profile not found" message={NOT_FOUND_MESSAGE} />;
  }
  if (state.status === 'error') {
    return <ErrorView message={state.message} />;
  }

  const { profile } = state;
  const { heading, handle } = pageHeading(profile);
  const joined = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(profile.joinedAt)
  );

  return (
    <>
      <div className="shared-view public-profile-view">
        <header className="public-profile-header">
          <ResponsiveAvatar imageUrl={profile.avatarImageUrl} name={heading} />
          <div className="public-profile-header-text">
            <h1 className="public-profile-name">{heading}</h1>
            {handle && <p className="public-profile-handle">{handle}</p>}
            {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}
            <p className="public-profile-joined">
              Joined {joined}
              {' · '}
              {profile.isOwner ? (
                // Your own profile: the way back to the editor on /you replaces
                // Report (nobody reports themselves). Closes the round trip the
                // Profile card's "public profile" link opens.
                <Link to="/you?section=profile" className="btn-link public-profile-report-btn">
                  Edit profile
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn-link public-profile-report-btn"
                  aria-label="Report this profile"
                  onClick={() => setReporting(true)}
                >
                  Report
                </button>
              )}
            </p>
          </div>
        </header>

        {profile.moderationHidden ? (
          <div className="public-profile-hidden-banner">
            <p>
              Your profile was hidden by a moderator. Contact support if you believe this is a
              mistake.
            </p>
          </div>
        ) : profile.decks.length === 0 ? (
          <div className="empty-state">
            <EmptyStateMark />
            <p className="empty-state-tagline">No public decks yet.</p>
            <p className="empty-state-hint">
              Publish a deck from its share menu to feature it here.
            </p>
            <div className="empty-state-actions">
              <Link to="/decks" className="btn btn-primary empty-state-action">
                Go to your decks
              </Link>
            </div>
          </div>
        ) : (
          <DeckGrid decks={profile.decks} username={profile.username} />
        )}
      </div>

      {reporting && (
        <ReportDialog
          kind="profile"
          targetId={profile.username}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
