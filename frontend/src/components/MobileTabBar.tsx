import { BookOpen, Layers, List, Settings, Users, UserPlus } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';
import { useRulesReferenceStore } from '../store/rules-reference';
import { useAuth } from '../store/auth';
import { useFriendRequests } from '../lib/use-friend-requests';
import { useInbox } from '../lib/use-inbox';

const ICON_PROPS = {
  className: 'mobile-tab-bar-icon',
  width: 22,
  height: 22,
  strokeWidth: 1.6,
  'aria-hidden': true,
} as const;

export function MobileTabBar() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const openRules = useRulesReferenceStore((s) => s.open);
  const isAuthed = useAuth((s) => s.status === 'authed');
  const pendingRequests = useFriendRequests();
  const { count: inboxCount } = useInbox();
  const socialCount = pendingRequests + inboxCount;
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
      <button type="button" className="mobile-tab-bar-link" onClick={openRules}>
        <span className="mobile-tab-bar-glyph">
          <BookOpen {...ICON_PROPS} />
        </span>
        <span className="mobile-tab-bar-label">Rules</span>
      </button>
      {isAuthed && (
        <NavLink
          to="/friends"
          className={({ isActive }) =>
            isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
          }
          aria-label={
            socialCount > 0
              ? `Friends, ${socialCount} notification${socialCount === 1 ? '' : 's'}`
              : 'Friends'
          }
        >
          <span className="mobile-tab-bar-glyph mobile-tab-bar-glyph-wrap">
            <UserPlus {...ICON_PROPS} />
            {socialCount > 0 && (
              <span className="mobile-tab-bar-badge" aria-hidden="true">
                {socialCount > 9 ? '9+' : socialCount}
              </span>
            )}
          </span>
          <span className="mobile-tab-bar-label">Friends</span>
        </NavLink>
      )}
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
