import { Link2, LogOut, Search, Settings, UserRound } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import { HeaderSyncIndicator } from './SyncIndicator';
import { useAuth } from '../store/auth';
import { useActivity } from '../lib/use-activity';
import { formatCount } from '../lib/format-count';
import { BrandMark } from './shared/BrandMark';
import { OverflowMenu } from './OverflowMenu';
import { UserAvatar } from './UserAvatar';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const authStatus = useAuth((s) => s.status);
  const isAuthed = authStatus === 'authed';
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const signInHref = useSignInPath();
  // One hook, one endpoint, two badges cut from the same bucket so they can
  // never disagree: Home carries the whole activity count (requests, trades,
  // unseen directed shares, feedback, likes); Friends carries only the
  // action-required subset — friend requests + trade offers, the two asks
  // that are actually answered on a social page. Same split FriendsPage
  // already uses for its own Trades door.
  const { count: socialCount, actionRequired } = useActivity();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink viewTransition className="site-brand" to="/collection" aria-label="SpellControl">
          <BrandMark size={28} aria-hidden className="site-brand-mark" />
          <span className="site-brand-text">SpellControl</span>
        </NavLink>
        <nav className="site-nav-links" aria-label="Primary">
          <NavLink
            viewTransition
            to="/home"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
            aria-label={
              socialCount > 0
                ? `Home, ${socialCount} notification${socialCount === 1 ? '' : 's'}`
                : undefined
            }
          >
            <span>Home</span>
            {socialCount > 0 && (
              <span className="friends-nav-link-badge" aria-hidden="true">
                {socialCount}
              </span>
            )}
          </NavLink>
          <NavLink
            viewTransition
            to="/collection"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Collection</span>
            {cardCount > 0 && (
              <span className="site-nav-count" aria-label={`${cardCount} cards`}>
                {formatCount(cardCount)}
              </span>
            )}
          </NavLink>
          <NavLink
            viewTransition
            to="/decks"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Decks</span>
            {deckCount > 0 && (
              <span className="site-nav-count" aria-label={`${deckCount} decks`}>
                {formatCount(deckCount)}
              </span>
            )}
          </NavLink>
          <NavLink
            viewTransition
            to="/play"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Play</span>
            {hasActiveGame && <span className="site-nav-game-dot" aria-label="game in progress" />}
          </NavLink>
          {/* The social cluster's front door. /friends, /trades, /pods and
              /friends/:id were a four-page cluster with no top-level entry —
              nav v2 dropped the Friends link on the premise that friends
              lived inside /you, and #1474 removed that premise without
              revisiting nav. Desktop has the room the phone bar doesn't
              (a 6th 44px tab-bar cell doesn't fit 320px), so the door lands
              here and, for the phone, on Home's Quick Actions — the tab the
              activity badge already points at. */}
          <NavLink
            viewTransition
            to="/friends"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
            aria-label={
              actionRequired.length > 0
                ? `Friends, ${actionRequired.length} waiting on you`
                : undefined
            }
          >
            <span>Friends</span>
            {actionRequired.length > 0 && (
              <span className="friends-nav-link-badge" aria-hidden="true">
                {actionRequired.length}
              </span>
            )}
          </NavLink>
        </nav>
        <nav className="site-nav">
          {/* Non-happy sync states (offline / error / pending) surface here so
              users see them wherever they are; the full indicator (with "Synced
              Nm ago") lives in the Settings Account card. Silence = synced. */}
          <HeaderSyncIndicator />
          <NavLink
            viewTransition
            to="/search"
            className={({ isActive }) =>
              isActive ? 'site-nav-settings active' : 'site-nav-settings'
            }
            aria-label="Card search"
          >
            <Search width={18} height={18} strokeWidth={1.6} aria-hidden />
            <span className="site-nav-settings-label">Search</span>
          </NavLink>
          {isAuthed ? (
            <OverflowMenu
              trigger={
                <UserAvatar
                  imageUrl={profile?.avatarImageUrl}
                  name={profile?.displayName ?? user?.username ?? ''}
                  size={28}
                />
              }
              triggerClassName="site-avatar-menu-trigger"
              ariaLabel="Account menu"
              align="right"
              items={[
                // Three doors into one page (/you): each is a `?section=`
                // jump that lands its promised heading at the top of the
                // viewport — Profile on the Profile card, Settings on the
                // Preferences tier (where everything below Identity starts),
                // Shared links on the Sharing group. See YouPage's
                // SECTION_HEADING_IDS for the vocabulary.
                {
                  label: 'Profile',
                  icon: UserRound,
                  onClick: () => navigate('/you?section=profile'),
                },
                {
                  label: 'Settings',
                  icon: Settings,
                  onClick: () => navigate('/you?section=settings'),
                },
                {
                  label: 'Shared links',
                  icon: Link2,
                  onClick: () => navigate('/you?section=sharing'),
                },
                { label: 'Sign out', icon: LogOut, onClick: logout },
              ]}
            />
          ) : (
            <Link viewTransition to={signInHref} className="site-nav-settings" aria-label="Sign in">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
