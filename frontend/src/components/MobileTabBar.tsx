import { Layers, List, Notebook, Settings, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';

const ICON_PROPS = {
  className: 'mobile-tab-bar-icon',
  width: 22,
  height: 22,
  strokeWidth: 1.6,
  'aria-hidden': true,
} as const;

// Firefox/Chrome on Android anchor `position: fixed; bottom: 0` to the
// *layout* viewport, but the *visual* viewport shrinks/grows as the URL
// bar animates in/out on scroll. That gap is what makes the bar jump.
// There is no CSS way to bind a fixed element to the visual viewport, so
// we translate the bar by the difference using the Visual Viewport API
// (its intended use). When the two viewports match the offset is 0 and
// no transform is applied, so desktop/Chrome are untouched.
function useVisualViewportPin(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const offset = Math.max(0, document.documentElement.clientHeight - vv.height - vv.offsetTop);
      el.style.transform = offset > 0 ? `translateY(-${offset}px)` : '';
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      el.style.transform = '';
    };
  }, [ref]);
}

export function MobileTabBar() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const navRef = useRef<HTMLElement>(null);
  useVisualViewportPin(navRef);
  return (
    <nav ref={navRef} className="mobile-tab-bar" aria-label="Primary mobile">
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
        to="/binders"
        className={({ isActive }) =>
          isActive ? 'mobile-tab-bar-link active' : 'mobile-tab-bar-link'
        }
      >
        <span className="mobile-tab-bar-glyph">
          <Notebook {...ICON_PROPS} />
        </span>
        <span className="mobile-tab-bar-label">Binders</span>
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
