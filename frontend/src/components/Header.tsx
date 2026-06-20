import { BookOpen, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import { useRulesReferenceStore } from '../store/rules-reference';
import { HeaderSyncIndicator } from './SyncIndicator';
import { useAuth } from '../store/auth';
import { useFriendRequests } from '../lib/use-friend-requests';
import { useInbox } from '../lib/use-inbox';
import { BrandMark } from './shared/BrandMark';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const openRules = useRulesReferenceStore((s) => s.open);
  const authStatus = useAuth((s) => s.status);
  const isAuthed = authStatus === 'authed';
  const pendingRequests = useFriendRequests();
  const { count: inboxCount } = useInbox();
  // One "Friends" badge covers both pending requests and unseen directed shares.
  const socialCount = pendingRequests + inboxCount;
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection" aria-label="SpellControl">
          <BrandMark size={28} aria-hidden className="site-brand-mark" />
          <span className="site-brand-text">SpellControl</span>
        </NavLink>
        <nav className="site-nav-links" aria-label="Primary">
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
          {isAuthed && (
            <NavLink
              to="/friends"
              className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
              aria-label={
                socialCount > 0
                  ? `Friends, ${socialCount} notification${socialCount === 1 ? '' : 's'}`
                  : 'Friends'
              }
            >
              <span>Friends</span>
              {socialCount > 0 && (
                <span className="friends-nav-link-badge" aria-hidden="true">
                  {socialCount}
                </span>
              )}
            </NavLink>
          )}
        </nav>
        <nav className="site-nav">
          {/* Non-happy sync states (offline / error / pending) surface here so
              users see them wherever they are; the full indicator (with "Synced
              Nm ago") lives in the Settings Account card. Silence = synced. */}
          <HeaderSyncIndicator />
          <button
            type="button"
            className="site-nav-settings"
            onClick={openRules}
            aria-label="Rules reference"
          >
            <BookOpen width={18} height={18} strokeWidth={1.6} aria-hidden />
            <span className="site-nav-settings-label">Rules</span>
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              isActive ? 'site-nav-settings active' : 'site-nav-settings'
            }
            aria-label="Settings"
          >
            <Settings width={18} height={18} strokeWidth={1.6} aria-hidden />
            <span className="site-nav-settings-label">Settings</span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
