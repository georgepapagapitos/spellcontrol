import { Layers, List, Settings, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';

/** Navigation destinations, top-to-bottom as they stack above the FAB. */
const ITEMS = [
  { to: '/collection', label: 'Collection', Icon: List },
  { to: '/decks', label: 'Decks', Icon: Layers },
  { to: '/play', label: 'Play', Icon: Users },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const;

const ICON_PROPS = { width: 22, height: 22, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * Native-only floating navigation control.
 *
 * Replaces the bottom tab bar inside the Capacitor WebView (web mobile keeps
 * `MobileTabBar`). A hamburger FAB sits locked in the bottom-right corner;
 * tapping it raises the four destinations in a vertical stack above it
 * (speed-dial style) — each an icon chip with a label pill — and tapping the
 * scrim, a destination, or pressing Escape closes it again.
 *
 * The FAB is `position:absolute` inside `.app-shell` (a stable 100dvh box),
 * not `position:fixed`, so it never gets caught by the mobile URL-bar shift
 * the shell layout exists to avoid.
 */
export function NavFab() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const [expanded, setExpanded] = useState(false);

  const fabRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  // Escape closes the menu and returns focus to the toggle.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        fabRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Move focus into the menu on open so keyboard / switch-control users land
  // on a destination instead of being stranded on the toggle.
  useEffect(() => {
    if (expanded) firstItemRef.current?.focus();
  }, [expanded]);

  return (
    <div className="nav-fab-root">
      <div
        className={`nav-fab-scrim${expanded ? ' open' : ''}`}
        onClick={() => setExpanded(false)}
        aria-hidden="true"
      />
      <div className={`nav-fab${expanded ? ' open' : ''}`}>
        <nav id="nav-fab-menu" className="nav-fab-menu" aria-label="Primary mobile">
          {ITEMS.map((item, i) => {
            const isPlay = item.to === '/play';
            return (
              <NavLink
                key={item.to}
                ref={i === 0 ? firstItemRef : undefined}
                to={item.to}
                tabIndex={expanded ? 0 : -1}
                aria-hidden={!expanded}
                className={({ isActive }) => (isActive ? 'nav-fab-item active' : 'nav-fab-item')}
                onClick={() => setExpanded(false)}
              >
                <span className="nav-fab-item-label">{item.label}</span>
                <span className="nav-fab-item-glyph">
                  <item.Icon {...ICON_PROPS} />
                  {isPlay && hasActiveGame && (
                    <span className="nav-fab-dot" aria-label="game in progress" />
                  )}
                </span>
              </NavLink>
            );
          })}
        </nav>
        <button
          type="button"
          ref={fabRef}
          className="nav-fab-btn"
          aria-label={expanded ? 'Close navigation' : 'Open navigation'}
          aria-expanded={expanded}
          aria-haspopup="true"
          aria-controls="nav-fab-menu"
          onClick={() => setExpanded((open) => !open)}
        >
          {/* Three bars that morph between a hamburger and an X — see the
              `.nav-fab-burger` rules. The button's aria-label carries the
              state for assistive tech. */}
          <span className="nav-fab-burger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {!expanded && hasActiveGame && <span className="nav-fab-dot" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
