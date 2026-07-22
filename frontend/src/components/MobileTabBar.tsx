import { CircleUserRound, Home, Layers, List, Search, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';
import { useAuth } from '../store/auth';
import { useActivity } from '../lib/use-activity';
import { UserAvatar } from './UserAvatar';

const ICON_PROPS = {
  className: 'mobile-tab-bar-icon',
  width: 22,
  height: 22,
  strokeWidth: 1.6,
  'aria-hidden': true,
} as const;

/**
 * The 5 primary destinations (Home / Collection / Decks / Play / You) shared
 * verbatim between web mobile and native (Layout.tsx renders this on both —
 * native additionally floats <ScanFab/> on top). A 6th, visually distinct
 * Search icon rides along as a compact utility affordance, not a co-equal
 * destination — see .mobile-tab-bar-search in responsive-nav.css.
 */
export function MobileTabBar() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const isAuthed = useAuth((s) => s.status === 'authed');
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  // One activity badge covers pending requests, unseen directed shares,
  // feedback, and likes — relocated here from the old Friends tab (Friends
  // now folds into You) since Home is the tab bar's landing destination.
  const { count } = useActivity();
  return (
    <nav className="mobile-tab-bar" aria-label="Primary mobile">
      <NavLink
        to="/home"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
        aria-label={count > 0 ? `Home, ${count} notification${count === 1 ? '' : 's'}` : 'Home'}
      >
        <span className="mobile-tab-bar-glyph mobile-tab-bar-glyph-wrap">
          <Home {...ICON_PROPS} />
          {count > 0 && (
            <span className="mobile-tab-bar-badge" aria-hidden="true">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
        <span className="mobile-tab-bar-label">Home</span>
      </NavLink>
      <NavLink
        to="/collection"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
        aria-label="Collection"
      >
        <span className="mobile-tab-bar-glyph">
          <List {...ICON_PROPS} />
        </span>
        {/* Long/short pair (STYLE_GUIDE short-label ruling): "Collection" is
            the one label wider than a 1/5 cell on narrow phones — it swaps to
            "Cards" (the collection hub's own first tab) below 420px. */}
        <span className="mobile-tab-bar-label mobile-tab-bar-label-long">Collection</span>
        <span className="mobile-tab-bar-label mobile-tab-bar-label-short" aria-hidden="true">
          Cards
        </span>
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
        to="/you"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
        aria-label={isAuthed ? `You, signed in as @${user?.username}` : 'You'}
      >
        <span className="mobile-tab-bar-glyph">
          {isAuthed ? (
            <UserAvatar
              imageUrl={profile?.avatarImageUrl}
              name={profile?.displayName ?? user?.username ?? ''}
              size={22}
            />
          ) : (
            <CircleUserRound {...ICON_PROPS} />
          )}
        </span>
        <span className="mobile-tab-bar-label">You</span>
      </NavLink>
      <NavLink
        to="/search"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-search active' : 'mobile-tab-bar-search'
        }
        aria-label="Search"
      >
        <Search {...ICON_PROPS} />
      </NavLink>
    </nav>
  );
}
