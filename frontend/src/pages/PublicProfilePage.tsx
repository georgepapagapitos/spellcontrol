import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFoundView, ErrorView } from '../components/share/SharedShell';
import { UserAvatar } from '../components/UserAvatar';
import { ReportDialog } from '../components/share/ReportDialog';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { formatIdentity, standaloneIdentity } from '../lib/display-name';
import { formatSocialCount } from '../lib/social-proof';
import { formatRelativeTime } from '../lib/format-time';
import {
  fetchProfileCollection,
  fetchPublicProfile,
  ProfileNotFoundError,
  ProfileRenamedError,
} from '../lib/profile-client';
import type { PublicCollection } from '../lib/shared-types';
import type { CollectionVisibility } from '../lib/auth-api';
import { Tabs, type TabItem } from '../components/Tabs';
import { SharedCollectionView } from '../components/share/SharedCollectionView';
import { CollectionVisibilityDialog } from '../components/CollectionVisibilityDialog';
import type { PublicProfile, PublicProfileDeck } from '../lib/profile-client';
import { DeckLibrary, type LibraryDeck } from '../components/decks/DeckLibrary';
import './PublicProfilePage.css';

import { userMessage } from '@/lib/user-error';
const NOT_FOUND_MESSAGE = "This profile doesn't exist.";

type ProfileTab = 'decks' | 'collection';

/** The owner's own line above their Collection tab: who else sees it. */
const OWNER_COLLECTION_NOTE: Record<CollectionVisibility | 'never', string> = {
  public: 'Anyone can see your collection here.',
  friends: 'Only your friends can see your collection here.',
  private: 'Only you can see your collection.',
  never:
    "Only you can see it here. Your friends see which cards you own, not how many or what they're worth.",
};
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

/**
 * A profile's Collection tab (board T136): the full collection, with
 * quantities, printings and prices, in the same browser a collection share
 * link opens. Fetched the first time the tab opens, not with the profile.
 */
function ProfileCollection({
  username,
  isOwner,
  visibility,
  onVisibilityChanged,
}: {
  username: string;
  isOwner: boolean;
  visibility: CollectionVisibility | null;
  onVisibilityChanged: (v: CollectionVisibility) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    data: PublicCollection | null;
    error: string | null;
  } | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProfileCollection(username)
      .then((data) => {
        if (!cancelled) setResult({ attempt, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            attempt,
            data: null,
            error: userMessage(err, "Couldn't load this collection. Try again."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [username, attempt]);

  const current = result?.attempt === attempt ? result : null;

  return (
    <>
      {isOwner && (
        <p className="public-profile-collection-note">
          {OWNER_COLLECTION_NOTE[visibility ?? 'never']}{' '}
          <button type="button" className="btn-link" onClick={() => setChanging(true)}>
            Change
          </button>
        </p>
      )}
      {current === null ? (
        <div
          className="public-profile-skeleton public-profile-collection-skeleton"
          aria-busy="true"
          aria-label="Loading collection"
        />
      ) : current.error ? (
        <p className="public-profile-collection-note" role="alert">
          {current.error}{' '}
          <button type="button" className="btn-link" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : (
        <SharedCollectionView data={current.data!} embedded />
      )}
      {changing && (
        <CollectionVisibilityDialog
          onClose={() => setChanging(false)}
          onChanged={onVisibilityChanged}
        />
      )}
    </>
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
  const [searchParams, setSearchParams] = useSearchParams();
  // The owner can change it from the Collection tab without a refetch.
  const [visibilityOverride, setVisibilityOverride] = useState<CollectionVisibility | null>(null);

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
  const canViewCollection = !profile.moderationHidden && !!profile.collection?.canView;
  const tab: ProfileTab =
    canViewCollection && searchParams.get('tab') === 'collection' ? 'collection' : 'decks';
  const setTab = (next: ProfileTab) =>
    setSearchParams(next === 'collection' ? { tab: 'collection' } : {}, { replace: true });
  const profileTabs: TabItem<ProfileTab>[] = [
    { id: 'decks', label: 'Decks', controls: 'public-profile-panel-decks' },
    { id: 'collection', label: 'Collection', controls: 'public-profile-panel-collection' },
  ];
  const decksBody = profile.moderationHidden ? (
    <div className="public-profile-hidden-banner">
      <p>
        Your profile was hidden by a moderator. Contact support if you believe this is a mistake.
      </p>
    </div>
  ) : profile.decks.length === 0 ? (
    profile.isOwner ? (
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">No public decks yet.</p>
        <p className="empty-state-hint">
          New decks are public unless you pick Private, and they show up here.
        </p>
        <div className="empty-state-actions">
          <Link to="/decks" className="btn btn-primary empty-state-action">
            Go to your decks
          </Link>
        </div>
      </div>
    ) : (
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">{heading} hasn&apos;t shared any decks yet.</p>
      </div>
    )
  ) : (
    <DeckGrid decks={profile.decks} username={profile.username} />
  );
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

        {canViewCollection ? (
          <>
            <Tabs
              ariaLabel="Profile views"
              variant="underline"
              value={tab}
              onChange={setTab}
              tabs={profileTabs}
              className="public-profile-tabs"
            />
            <div
              role="tabpanel"
              id="public-profile-panel-decks"
              aria-labelledby="sc-tab-decks"
              hidden={tab !== 'decks'}
            >
              {decksBody}
            </div>
            <div
              role="tabpanel"
              id="public-profile-panel-collection"
              aria-labelledby="sc-tab-collection"
              hidden={tab !== 'collection'}
            >
              {tab === 'collection' && (
                <ProfileCollection
                  username={profile.username}
                  isOwner={profile.isOwner}
                  visibility={visibilityOverride ?? profile.collection?.visibility ?? null}
                  onVisibilityChanged={setVisibilityOverride}
                />
              )}
            </div>
          </>
        ) : (
          decksBody
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
