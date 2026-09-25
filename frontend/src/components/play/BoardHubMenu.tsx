import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useMenuKeyboard } from '../../lib/use-menu-keyboard';
import { hubPetalPositions, type Point } from '../../lib/board-hub-layout';
import './BoardHubMenu.css';

export interface HubPetal {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

/**
 * The board hub's radial petal menu (Lotus's fan-out ring): tapping the hub
 * (outside commander-damage mode) mounts this instead of opening the game
 * menu directly. Screen-relative, like the hub itself — positions are
 * computed from the hub's on-screen rect, not from the board's rotated seat
 * space, so the ring reads upright for whoever is holding the device.
 *
 * `useMenuKeyboard` supplies the real WAI-ARIA menu behaviour for free: focus
 * moves into the first petal on open, Arrow/Home/End roam the ring, Escape
 * and an outside tap close it and return focus to the hub. A backdrop sits
 * behind the petals — not to dim the board (the ring is a quick glance, not a
 * takeover) but so a tap meant to dismiss the ring lands on the backdrop
 * instead of falling through to whatever panel is underneath it, the same
 * hazard `.game-menu-backdrop` already guards against.
 */
export function BoardHubMenu({
  hubRef,
  onClose,
  petals,
  openedByKeyboard = true,
}: {
  hubRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  petals: HubPetal[];
  /** How this open was triggered. A pointer open still moves focus into the
   *  first petal (arrow-key roaming has to start somewhere either way), but
   *  doesn't draw its ring — a tap on the hub isn't "selecting" Restart, and
   *  Chromium can otherwise still show `:focus-visible` on a script-driven
   *  `.focus()` moments after a real pointer click (verified in a real
   *  browser, not assumed from the spec's heuristic wording). Defaults to
   *  true so every other caller (there are none yet, but this is a shared
   *  primitive) keeps the WAI-ARIA-correct ring unless it opts out. */
  openedByKeyboard?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = hubRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      // Bound the ring to the SEAT GRID, not the whole window: since the
      // table clock became a full-width edge strip below the grid, the
      // window includes that strip, and a petal clamped only to the window
      // could land on it. `hubPetalPositions` works in whatever coordinate
      // origin `hub` and `viewport` share, so both are expressed relative to
      // the grid's own top-left here and the results shifted back to
      // viewport-absolute pixels for the fixed-position ring's CSS. Falls
      // back to the window if the grid can't be found (defensive only — the
      // hub always renders inside `.game-board-grid`).
      const grid = btn.closest('.game-board-grid');
      const gridRect = grid?.getBoundingClientRect();
      const origin = gridRect ? { x: gridRect.left, y: gridRect.top } : { x: 0, y: 0 };
      const viewport = gridRect
        ? { width: gridRect.width, height: gridRect.height }
        : { width: window.innerWidth, height: window.innerHeight };
      const hub = {
        x: rect.left + rect.width / 2 - origin.x,
        y: rect.top + rect.height / 2 - origin.y,
      };
      setPoints(
        hubPetalPositions(hub, viewport, petals.length).map((p) => ({
          x: p.x + origin.x,
          y: p.y + origin.y,
        }))
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hubRef, petals.length]);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open: true,
    onClose,
    panelRef,
    triggerRef: hubRef,
  });

  // useMenuKeyboard focuses the first petal on open unconditionally (right —
  // arrow-key roaming needs a start either way). This only controls whether
  // THAT focus draws a ring: a class scoped to the panel, removed on the
  // first real keydown so keyboard nav after a pointer-open still shows a
  // ring for wherever focus lands next.
  useEffect(() => {
    if (openedByKeyboard) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.classList.add('board-hub-ring-pointer-opened');
    const clear = () => panel.classList.remove('board-hub-ring-pointer-opened');
    document.addEventListener('keydown', clear, { once: true });
    return () => {
      document.removeEventListener('keydown', clear);
      panel.classList.remove('board-hub-ring-pointer-opened');
    };
  }, [openedByKeyboard]);

  return (
    <>
      <div className="board-hub-backdrop" aria-hidden="true" />
      <div ref={panelRef} className="board-hub-ring" role="menu" aria-label="Board menu">
        {petals.map((petal, i) => {
          const pos = points[i];
          return (
            <button
              key={petal.id}
              type="button"
              role="menuitem"
              className="board-hub-petal"
              style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { opacity: 0 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeAndReturnFocus();
                petal.onSelect();
              }}
            >
              {petal.icon}
              <span>{petal.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
