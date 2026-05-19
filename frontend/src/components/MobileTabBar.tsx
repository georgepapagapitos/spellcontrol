import { Layers, List, Settings, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';

const ICON_PROPS = {
  className: 'mobile-tab-bar-icon',
  width: 22,
  height: 22,
  strokeWidth: 1.6,
  'aria-hidden': true,
} as const;

export function MobileTabBar() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  return (
    <nav className="mobile-tab-bar" aria-label="Primary mobile">
      <NavLink
        to="/collection"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <List {...ICON_PROPS} />
        </span>
        <span className="mobile-tab-bar-label">Collection</span>
      </NavLink>
      <NavLink
        to="/decks"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <Layers {...ICON_PROPS} />
        </span>
        <span className="mobile-tab-bar-label">Decks</span>
      </NavLink>
      <NavLink
        to="/play"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <Users {...ICON_PROPS} />
          {hasActiveGame && (
            <span className="mobile-tab-bar-game-dot" aria-label="game in progress" />
          )}
        </span>
        <span className="mobile-tab-bar-label">Play</span>
      </NavLink>
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <Settings {...ICON_PROPS} />
        </span>
        <span className="mobile-tab-bar-label">Settings</span>
      </NavLink>
    </nav>
  );
}
