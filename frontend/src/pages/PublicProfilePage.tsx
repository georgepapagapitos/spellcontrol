import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SharedShell, NotFoundView, ErrorView } from '../components/shared/SharedShell';
import { UserAvatar } from '../components/UserAvatar';
import { ColorPip } from '../components/shared/ManaSymbol';
import { ReportDialog } from '../components/shared/ReportDialog';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { formatIdentity } from '../lib/display-name';
import { formatSocialCount } from '../lib/social-proof';
import { formatRelativeTime } from '../lib/format-time';
import { fetchPublicProfile, ProfileNotFoundError } from '../lib/profile-client';
import type { PublicProfile, PublicProfileDeck } from '../lib/profile-client';
import { usePanelCascade, panelCascadeClass } from '../lib/use-panel-cascade';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '../deck-builder/types';
import './PublicProfilePage.css';

const NOT_FOUND_MESSAGE = "This profile doesn't exist or has no public decks to show.";
// Platform counts (views/copies) below this read as noise on a brand-new
// publisher's profile, so each is hidden individually rather than showing a
// discouraging "1 view" — see PLAN.md's ghost-town-proofing rationale.
const GHOST_TOWN_THRESHOLD = 5;
const SKELETON_TILE_COUNT = 6;

function formatLabel(format: string): string {
  return DECK_FORMAT_CONFIGS[format as DeckFormat]?.label ?? format;
}

function colorSummary(colorIdentity: string[]): string {
  if (colorIdentity.length === 0) return 'Colorless';
  return `${colorIdentity.length} color${colorIdentity.length === 1 ? '' : 's'}`;
}

/** displayName-or-@username for the page heading/title — deliberately NOT
 *  `formatIdentity(...).primary` (which returns a bare, un-prefixed
 *  username): a standalone heading with no "Shared by"-style framing needs
 *  the "@" to read as a handle rather than an unset display name. */
function pageHeading(profile: Pick<PublicProfile, 'username' | 'displayName'>): {
  heading: string;
  handle: string | null;
} {
  const identity = formatIdentity({ username: profile.username, displayName: profile.displayName });
  return {
    heading: identity.secondary ? identity.primary : `@${profile.username}`,
    handle: identity.secondary,
  };
}

function deckTileAriaLabel(deck: PublicProfileDeck): string {
  const parts = [deck.name, formatLabel(deck.format), colorSummary(deck.colorIdentity)];
  if (deck.bracket != null) parts.push(`Bracket ${deck.bracket}`);
  if (deck.viewCount >= GHOST_TOWN_THRESHOLD) parts.push(`${deck.viewCount} views`);
  if (deck.copyCount >= GHOST_TOWN_THRESHOLD) parts.push(`${deck.copyCount} copies`);
  return parts.join(', ');
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
    <main className="shared-view public-profile-view" aria-busy="true" aria-label="Loading profile">
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
    </main>
  );
}

/**
 * On-art overlay line (tile system v2) — views/copies (ghost-town-
 * thresholded via the shared `formatSocialCount`, same floor as
 * `GHOST_TOWN_THRESHOLD`) plus recency. Mirrors DiscoverDeckTile's grid
 * banner overlay so the app's two art-banner tile families read
 * identically. Never empty — `formatRelativeTime` always returns something.
 */
function tileStatsLine(deck: PublicProfileDeck): string {
  const views = formatSocialCount(deck.viewCount);
  const copies = formatSocialCount(deck.copyCount);
  const parts = [views && `${views} views`, copies && `${copies} copies`].filter(
    (s): s is string => s != null
  );
  parts.push(formatRelativeTime(deck.publishedAt));
  return parts.join(' · ');
}

function DeckTile({
  deck,
  index,
  animating,
}: {
  deck: PublicProfileDeck;
  index: number;
  animating: boolean;
}) {
  const colors = deck.colorIdentity.slice(0, 5);
  const cascadeCls = panelCascadeClass(index, animating);
  return (
    <li className={`decks-index-card public-profile-tile${cascadeCls ? ` ${cascadeCls}` : ''}`}>
      <Link
        to={`/d/${deck.slug}`}
        className="decks-index-card-link"
        aria-label={deckTileAriaLabel(deck)}
      >
        <span className="public-profile-tile-banner">
          {deck.commanderImage ? (
            <img
              className="decks-index-card-art"
              src={deck.commanderImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
            />
          ) : (
            <span className="decks-index-card-banner" aria-hidden="true">
              {colors.length > 0 && (
                <span className="decks-index-card-banner-pips">
                  {colors.map((c) => (
                    <ColorPip key={c} color={c} pip="lg" />
                  ))}
                </span>
              )}
            </span>
          )}
          <span className="public-profile-tile-banner-stats" aria-hidden="true">
            {tileStatsLine(deck)}
          </span>
        </span>
        <span className="public-profile-tile-colorbar" aria-hidden="true">
          {(colors.length > 0 ? colors : ['C']).map((c, i) => (
            <span
              key={`${c}-${i}`}
              className={`public-profile-tile-colorbar-seg public-profile-tile-colorbar-seg--${c.toLowerCase()}`}
            />
          ))}
        </span>
        <div className="decks-index-card-body">
          <div className="decks-index-card-name">
            <span>{deck.name}</span>
          </div>
          <div className="decks-index-card-meta">
            {colors.length > 0 && (
              <span className="decks-index-card-pips">
                {colors.map((c) => (
                  <ColorPip key={c} color={c} />
                ))}
              </span>
            )}
            <span className="deck-format-badge">{formatLabel(deck.format)}</span>
            {deck.bracket != null && (
              <span className="deck-format-badge">Bracket {deck.bracket}</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function DeckGrid({ decks, username }: { decks: PublicProfileDeck[]; username: string }) {
  // Keyed per-username (a "computation identity", STYLE_GUIDE § Motion) rather
  // than a single static page key — each profile's grid is different data, so
  // browsing from one profile to another should cascade again, unlike the
  // decks-index page's single always-your-own-decks key.
  const cascade = usePanelCascade(decks.length > 0 ? `public-profile:${username}` : null);
  return (
    <ul className="decks-index-list is-grid" role="list">
      {decks.map((deck, i) => (
        <DeckTile key={deck.slug} deck={deck} index={i} animating={cascade.animating} />
      ))}
    </ul>
  );
}

export function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  if (!username) {
    return (
      <SharedShell>
        <NotFoundView title="Profile not found" message={NOT_FOUND_MESSAGE} />
      </SharedShell>
    );
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

  useEffect(() => {
    let cancelled = false;
    fetchPublicProfile(username)
      .then((profile) => {
        if (!cancelled) setState({ status: 'ready', profile });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ProfileNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load this profile.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    document.title = `${pageHeading(state.profile).heading} — SpellControl`;
  }, [state]);

  if (state.status === 'loading') {
    return (
      <SharedShell>
        <ProfileSkeleton />
      </SharedShell>
    );
  }
  if (state.status === 'notFound') {
    return (
      <SharedShell>
        <NotFoundView title="Profile not found" message={NOT_FOUND_MESSAGE} />
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell>
        <ErrorView message={state.message} />
      </SharedShell>
    );
  }

  const { profile } = state;
  const { heading, handle } = pageHeading(profile);
  const joined = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(profile.joinedAt)
  );

  return (
    <SharedShell
      action={
        <button
          type="button"
          className="btn-link public-profile-report-btn"
          aria-label="Report this profile"
          onClick={() => setReporting(true)}
        >
          Report
        </button>
      }
    >
      <main className="shared-view public-profile-view">
        <header className="public-profile-header">
          <ResponsiveAvatar imageUrl={profile.avatarImageUrl} name={heading} />
          <div className="public-profile-header-text">
            <h1 className="public-profile-name">{heading}</h1>
            {handle && <p className="public-profile-handle">{handle}</p>}
            {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}
            <p className="public-profile-joined">Joined {joined}</p>
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
      </main>

      {reporting && (
        <ReportDialog
          kind="profile"
          targetId={profile.username}
          onClose={() => setReporting(false)}
        />
      )}
    </SharedShell>
  );
}
