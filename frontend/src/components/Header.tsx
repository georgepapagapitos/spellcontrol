import { NavLink } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const deckCount = useDecksStore((s) => s.decks.length);
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
            to="/binders"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Binders</span>
            {binderCount > 0 && (
              <span className="site-nav-count" aria-label={`${binderCount} binders`}>
                {binderCount}
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
        </nav>
        <nav className="site-nav">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              isActive ? 'site-nav-settings active' : 'site-nav-settings'
            }
            aria-label="Settings"
          >
            <GearIcon />
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

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
