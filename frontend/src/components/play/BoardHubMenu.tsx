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

/** `el`'s position relative to `ancestor`'s own (pre-transform) layout box,
 *  via the offsetParent chain — unlike `getBoundingClientRect`, this is
 *  unaffected by any CSS transform on `ancestor` or anything between them.
 *  Used only for the board-rotated case below: `position: fixed` on a
 *  descendant of a transformed ancestor resolves its `top`/`left` against
 *  that ancestor's own local box, not real screen pixels, so the ring's
 *  petal math needs the same local terms `getBoundingClientRect` can't give
 *  it once the board is counter-rotated. */
function localRectRelativeTo(
  el: HTMLElement,
  ancestor: HTMLElement
): { x: number; y: number; width: number; height: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * The board hub's radial petal menu (Lotus's fan-out ring): tapping the hub
 * (outside commander-damage mode) mounts this instead of opening the game
 * menu directly.
 *
 * Screen-relative in the ordinary case — positions come from the hub's real
 * on-screen rect, not from any individual seat's rotation, so the ring reads
 * upright for whoever is holding the device regardless of which seat's
 * rotation the hub happens to sit near. Under the board's own landscape
 * "keep it still" counter-rotation (`boardRotation`), the ring rotates WITH
 * the board instead — the whole point of that feature is to keep reading in
 * the original portrait framing, and a screen-upright ring floating over a
 * counter-rotated board would read as broken, not upright. `.game-board`'s
 * `position: fixed` ring already achieves this for free once nested inside
 * the transformed `.game-board-rotator` (a transformed ancestor becomes the
 * fixed-position containing block, per the CSS spec) — the only thing that
 * has to change is the JS measurement, from screen pixels
 * (`getBoundingClientRect`) to the rotator's own local pre-transform terms
 * (`localRectRelativeTo`), which is what that containing block actually
 * resolves `top`/`left` against.
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
  boardRotation = 0,
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
  /** The board's own landscape counter-rotation (0/90/-90) — see above. */
  boardRotation?: 0 | 90 | -90;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = hubRef.current;
      if (!btn) return;

      if (boardRotation !== 0) {
        const rotator = btn.closest('.game-board-rotator') as HTMLElement | null;
        const grid = btn.closest('.game-board-grid') as HTMLElement | null;
        if (rotator && grid) {
          const gridLocal = localRectRelativeTo(grid, rotator);
          const hubLocal = localRectRelativeTo(btn, rotator);
          const origin = { x: gridLocal.x, y: gridLocal.y };
          const hub = {
            x: hubLocal.x + hubLocal.width / 2 - origin.x,
            y: hubLocal.y + hubLocal.height / 2 - origin.y,
          };
          const viewport = { width: gridLocal.width, height: gridLocal.height };
          setPoints(
            hubPetalPositions(hub, viewport, petals.length).map((p) => ({
              x: p.x + origin.x,
              y: p.y + origin.y,
            }))
          );
          return;
        }
      }

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
  }, [hubRef, petals.length, boardRotation]);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open: true,
    onClose,
    panelRef,
    triggerRef: hubRef,
    // The board never scrolls; see the option's own doc.
    preventScroll: true,
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
