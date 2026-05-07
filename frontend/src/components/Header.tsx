import { NavLink } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { ThemePicker } from './ThemePicker';

export function Header() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection" aria-label="MTG Binder Planner">
          <span className="site-brand-mark" aria-hidden="true">
            MBP
          </span>
          <span className="site-brand-text">MTG Binder Planner</span>
        </NavLink>
        <nav className="site-nav-links">
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
            to="/binder"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            <span>Binders</span>
            {binderCount > 0 && (
              <span className="site-nav-count" aria-label={`${binderCount} binders`}>
                {binderCount}
              </span>
            )}
          </NavLink>
        </nav>
        <nav className="site-nav">
          <ThemePicker />
        </nav>
      </div>
    </header>
  );
}

/** Compact thousands formatting so a 12,000-card collection still fits the nav. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
