import { Layers, List, Menu, Settings, Users, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { haptics } from '../lib/haptics';
import {
  fanItemOffset,
  loadFabCorner,
  nearestCorner,
  saveFabCorner,
  type FabCorner,
} from '../lib/nav-fab-geometry';
import { usePlayStore } from '../store/play';

/** Navigation destinations, in fan order (item 0 fans out first). */
const ITEMS = [
  { to: '/collection', label: 'Collection', Icon: List },
  { to: '/decks', label: 'Decks', Icon: Layers },
  { to: '/play', label: 'Play', Icon: Users },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const;

/** Hold this long without lifting to pick the FAB up for repositioning. */
const LONG_PRESS_MS = 420;
/** Movement beyond this before the long-press fires cancels the gesture. */
const TAP_SLOP_PX = 10;
/** Keep the FAB centre this far from the container edges while dragging. */
const DRAG_MARGIN_PX = 36;

const ICON_PROPS = { width: 22, height: 22, strokeWidth: 1.7, 'aria-hidden': true } as const;

interface PressState {
  pointerId: number;
  startX: number;
  startY: number;
  /** Moved past the tap slop before the long-press armed — gesture aborted. */
  cancelled: boolean;
  /** Long-press fired: the FAB is being repositioned, not tapped. */
  dragging: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Native-only floating navigation control.
 *
 * Replaces the bottom tab bar inside the Capacitor WebView (web mobile keeps
 * `MobileTabBar`). A hamburger FAB docks to a screen corner; tapping fans the
 * four destinations out along the quadrant that opens into the screen, and a
 * long-press picks the FAB up to drag it to a different corner — the fan
 * re-orients to wherever it lands.
 *
 * The FAB is `position:absolute` inside `.app-shell` (a stable 100dvh box),
 * not `position:fixed`, so it never gets caught by the mobile URL-bar shift
 * the shell layout exists to avoid.
 */
export function NavFab() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);

  const [corner, setCorner] = useState<FabCorner>(loadFabCorner);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** FAB centre in container px while dragging; null when docked to a corner. */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const pressRef = useRef<PressState | null>(null);

  const close = useCallback(() => setExpanded(false), []);

  // Escape closes the fan; route changes (a tapped item) close it too.
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

  // Move focus into the fan on open so keyboard / switch-control users land on
  // a destination instead of being stranded on the toggle.
  useEffect(() => {
    if (expanded) firstItemRef.current?.focus();
  }, [expanded]);

  const clearPress = () => {
    const press = pressRef.current;
    if (press?.timer) clearTimeout(press.timer);
    pressRef.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Optional-chain the method too: not every WebView / test DOM implements
    // pointer capture, and a missing method must not abort the gesture.
    fabRef.current?.setPointerCapture?.(e.pointerId);
    const press: PressState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cancelled: false,
      dragging: false,
      timer: null,
    };
    // Long-press only arms a drag while collapsed — an open fan stays put.
    if (!expanded) {
      press.timer = setTimeout(() => {
        const root = rootRef.current?.getBoundingClientRect();
        if (!root) return;
        press.dragging = true;
        haptics.tap();
        setDragging(true);
        setDragPos({ x: press.startX - root.left, y: press.startY - root.top });
      }, LONG_PRESS_MS);
    }
    pressRef.current = press;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    if (press.dragging) {
      const root = rootRef.current?.getBoundingClientRect();
      if (!root) return;
      const clamp = (v: number, max: number) =>
        Math.min(Math.max(v, DRAG_MARGIN_PX), max - DRAG_MARGIN_PX);
      setDragPos({
        x: clamp(e.clientX - root.left, root.width),
        y: clamp(e.clientY - root.top, root.height),
      });
      return;
    }
    // Not yet dragging: a real move before the long-press means scroll/cancel.
    const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
    if (moved > TAP_SLOP_PX) {
      press.cancelled = true;
      if (press.timer) clearTimeout(press.timer);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    if (press.timer) clearTimeout(press.timer);

    if (press.dragging) {
      const root = rootRef.current?.getBoundingClientRect();
      if (root) {
        const x = e.clientX - root.left;
        const y = e.clientY - root.top;
        const next = nearestCorner(x, y, root.width, root.height);
        setCorner(next);
        saveFabCorner(next);
        haptics.tap();
      }
      setDragging(false);
      setDragPos(null);
    } else if (!press.cancelled) {
      // A clean tap toggles the fan.
      setExpanded((open) => !open);
    }
    pressRef.current = null;
  };

  const onPointerCancel = () => {
    setDragging(false);
    setDragPos(null);
    clearPress();
  };

  // While dragging, the FAB follows the finger via inline left/top (which
  // over-constrains and thus overrides the corner class's bottom/right).
  const dragStyle: CSSProperties | undefined = dragPos
    ? { left: dragPos.x, top: dragPos.y, right: 'auto', bottom: 'auto' }
    : undefined;

  return (
    <div className="nav-fab-root" ref={rootRef}>
      <div
        className={`nav-fab-scrim${expanded ? ' open' : ''}`}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className={`nav-fab nav-fab--${corner}${expanded ? ' open' : ''}${
          dragging ? ' dragging' : ''
        }`}
        style={dragStyle}
      >
        <nav id="nav-fab-menu" className="nav-fab-menu" aria-label="Primary mobile">
          {ITEMS.map((item, i) => {
            const off = fanItemOffset(corner, i, ITEMS.length);
            const isPlay = item.to === '/play';
            return (
              <NavLink
                key={item.to}
                ref={i === 0 ? firstItemRef : undefined}
                to={item.to}
                tabIndex={expanded ? 0 : -1}
                aria-hidden={!expanded}
                style={{ '--fx': `${off.x}px`, '--fy': `${off.y}px` } as CSSProperties}
                className={({ isActive }) => (isActive ? 'nav-fab-item active' : 'nav-fab-item')}
                onClick={close}
              >
                <span className="nav-fab-item-glyph">
                  <item.Icon {...ICON_PROPS} />
                  {isPlay && hasActiveGame && (
                    <span className="nav-fab-dot" aria-label="game in progress" />
                  )}
                </span>
                <span className="nav-fab-item-label">{item.label}</span>
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {expanded ? (
            <X width={24} height={24} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Menu width={24} height={24} strokeWidth={2} aria-hidden="true" />
          )}
          {!expanded && hasActiveGame && <span className="nav-fab-dot" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
