import { LogIn, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import { useAuth } from '../store/auth';
import { SyncIndicator } from './SyncIndicator';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const isGuest = useAuth((s) => s.status === 'guest');
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection" aria-label="SpellControl">
          <span className="site-brand-mark" aria-hidden="true">
            SC
          </span>
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
        </nav>
        <nav className="site-nav">
          <SyncIndicator />
          {isGuest && (
            <NavLink to="/auth" className="site-nav-signin">
              <LogIn width={16} height={16} strokeWidth={1.8} aria-hidden />
              <span className="site-nav-signin-label">Sign in</span>
            </NavLink>
          )}
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
