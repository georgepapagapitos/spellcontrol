import { Link2, LogOut, Search, Settings, UserRound } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
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
  // One "Home" badge covers pending requests, unseen directed shares,
  // feedback, and likes — one endpoint, one hook, no duplicated math. Home
  // now carries the badge the (removed) Friends link used to, since Friends
  // folds into the account menu / You.
  const { count: socialCount } = useActivity();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection" aria-label="SpellControl">
          <BrandMark size={28} aria-hidden className="site-brand-mark" />
          <span className="site-brand-text">SpellControl</span>
        </NavLink>
        <nav className="site-nav-links" aria-label="Primary">
          <NavLink
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
            to="/decks"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Decks</span>
            {deckCount > 0 && (
              <span className="site-nav-count" aria-label={`${deckCount} decks`}>
                {deckCount}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/play"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Play</span>
            {hasActiveGame && <span className="site-nav-game-dot" aria-label="game in progress" />}
          </NavLink>
        </nav>
        <nav className="site-nav">
          {/* Non-happy sync states (offline / error / pending) surface here so
              users see them wherever they are; the full indicator (with "Synced
              Nm ago") lives in the Settings Account card. Silence = synced. */}
          <HeaderSyncIndicator />
          <NavLink
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
                { label: 'Profile', icon: UserRound, onClick: () => navigate('/you') },
                {
                  label: 'Settings',
                  icon: Settings,
                  onClick: () => navigate('/you?section=appearance'),
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
            <Link to="/you" className="site-nav-settings" aria-label="Sign in">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
