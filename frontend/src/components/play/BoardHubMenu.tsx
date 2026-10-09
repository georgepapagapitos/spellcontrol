import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useMenuKeyboard } from '@/lib/overlays/use-menu-keyboard';
import { hubPetalPositions, type Point, type Size } from '@/lib/play/board-hub-layout';
import './BoardHubMenu.css';

export interface HubPetal {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** The one filled key (Rematch on a finished board). */
  primary?: boolean;
}

/** A ring key's box, in CSS px. `.board-hub-key` sets exactly these (px, not
 *  rem, so the geometry below and the rendered box can never disagree). A
 *  seat grid under 359px wide (a 320px phone) takes the compact size. */
const HUB_KEY: Size = { width: 72, height: 64 };
const HUB_KEY_COMPACT: Size = { width: 66, height: 60 };
const COMPACT_BELOW = 359;
const RADIUS = 108;
const RADIUS_COMPACT = 98;
/** How far the dark disc behind the keys reaches past their outer edge. */
const DISC_PAD = 22;

interface Geometry {
  points: Point[];
  hub: Point;
  radius: number;
  compact: boolean;
  /** Every key sits on one circle round the hub (false when the fan
   *  fallback or the final clamp bent the ring), so the track can be drawn. */
  onCircle: boolean;
}

type Box = { x: number; y: number; width: number; height: number };

/** `el`'s position relative to `ancestor`'s own (pre-transform) layout box,
 *  via the offsetParent chain — unlike `getBoundingClientRect`, this is
 *  unaffected by any CSS transform on `ancestor` or anything between them.
 *  Used only for the board-rotated case below: `position: fixed` on a
 *  descendant of a transformed ancestor resolves its `top`/`left` against
 *  that ancestor's own local box, not real screen pixels, so the ring's
 *  key math needs the same local terms `getBoundingClientRect` can't give
 *  it once the board is counter-rotated. */
function localRectRelativeTo(el: HTMLElement, ancestor: HTMLElement): Box {
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
 * The board hub's ring (Lotus's radial menu; board T155, Direction A).
 * Tapping the hub outside commander-damage mode dims the board under a scrim
 * and places labeled rect keys evenly on one circle round it, with a dock of
 * the away-from-the-table places along the board's bottom edge. Keys and dock
 * are one `role="menu"`, in that order.
 *
 * Screen-relative in the ordinary case: positions come from the hub's real
 * on-screen rect, not from any seat's rotation, so the ring reads upright for
 * whoever holds the device. Under the board's landscape "keep it still"
 * counter-rotation (`boardRotation`) the ring rotates WITH the board instead,
 * because a screen-upright ring over a counter-rotated board reads as broken.
 * The ring's `position: fixed` gets that for free once nested inside the
 * transformed `.game-board-rotator` (a transformed ancestor becomes the
 * fixed-position containing block); only the measurement changes, from
 * screen pixels (`getBoundingClientRect`) to the rotator's own local terms
 * (`localRectRelativeTo`).
 *
 * The keys are bounded to the seat grid AND kept above the dock: the dock
 * covers the clock strip, and with the strip turned off it covers the grid's
 * bottom edge instead, so the grid alone is not the bound.
 *
 * `useMenuKeyboard` supplies the WAI-ARIA menu behavior: focus moves to the
 * first key on open, Arrow/Home/End walk the keys clockwise and then the
 * dock, Escape and an outside tap close it and return focus to the hub. The
 * scrim is what an outside tap lands on, so it never falls through to the
 * seat underneath.
 */
export function BoardHubMenu({
  hubRef,
  onClose,
  petals,
  dock = [],
  openedByKeyboard = true,
  boardRotation = 0,
}: {
  hubRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** The ring's keys, clockwise from the top. */
  petals: HubPetal[];
  /** The bottom dock's items, after the keys in keyboard order. */
  dock?: HubPetal[];
  /** How this open was triggered. A pointer open still moves focus to the
   *  first key (arrow-key roaming has to start somewhere), but doesn't draw
   *  its ring: a tap on the hub isn't "selecting" High roll, and Chromium can
   *  still show `:focus-visible` on a script-driven `.focus()` moments after
   *  a real pointer click (verified in a real browser). */
  openedByKeyboard?: boolean;
  /** The board's own landscape counter-rotation (0/90/-90), see above. */
  boardRotation?: 0 | 90 | -90;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = hubRef.current;
      if (!btn) return;
      const grid = btn.closest('.game-board-grid') as HTMLElement | null;
      const rotator =
        boardRotation !== 0 ? (btn.closest('.game-board-rotator') as HTMLElement | null) : null;

      // Grid and hub in the ring's own fixed-position coordinates: screen
      // pixels normally, the rotator's local box when the board is turned.
      let gridBox: Box;
      let hubBox: Box;
      if (rotator && grid) {
        gridBox = localRectRelativeTo(grid, rotator);
        hubBox = localRectRelativeTo(btn, rotator);
      } else {
        const r = btn.getBoundingClientRect();
        hubBox = { x: r.left, y: r.top, width: r.width, height: r.height };
        // Falls back to the window if the grid can't be found (defensive
        // only: the hub always renders inside `.game-board-grid`).
        const g = grid?.getBoundingClientRect();
        gridBox = g
          ? { x: g.left, y: g.top, width: g.width, height: g.height }
          : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      }

      // The dock is absolutely placed in the fixed ring, so its offsetTop is
      // already in the ring's own terms, rotated or not.
      const dockTop = dockRef.current ? dockRef.current.offsetTop : Infinity;
      const viewport = {
        width: gridBox.width,
        height: Math.min(gridBox.height, dockTop - gridBox.y),
      };
      const compact = gridBox.width < COMPACT_BELOW;
      const hub = {
        x: hubBox.x + hubBox.width / 2 - gridBox.x,
        y: hubBox.y + hubBox.height / 2 - gridBox.y,
      };
      const local = hubPetalPositions(hub, viewport, petals.length, {
        petal: compact ? HUB_KEY_COMPACT : HUB_KEY,
        radius: compact ? RADIUS_COMPACT : RADIUS,
      });
      const distances = local.map((p) => Math.hypot(p.x - hub.x, p.y - hub.y));
      const radius = distances[0] ?? 0;
      setGeo({
        points: local.map((p) => ({ x: p.x + gridBox.x, y: p.y + gridBox.y })),
        hub: { x: hub.x + gridBox.x, y: hub.y + gridBox.y },
        radius,
        compact,
        onCircle: distances.every((d) => Math.abs(d - radius) < 1),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hubRef, petals.length, dock.length, boardRotation]);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open: true,
    onClose,
    panelRef,
    triggerRef: hubRef,
    // The board never scrolls; see the option's own doc.
    preventScroll: true,
  });

  // useMenuKeyboard focuses the first key on open unconditionally (arrow-key
  // roaming needs a start either way). This only controls whether THAT focus
  // draws a ring: a class on the panel, dropped on the first real keydown so
  // keyboard nav after a pointer open still shows a ring. State, not a
  // classList edit: the panel's className re-renders (compact), and React
  // would wipe a class it doesn't know about.
  const [pointerOpened, setPointerOpened] = useState(!openedByKeyboard);
  useEffect(() => {
    if (!pointerOpened) return;
    const clear = () => setPointerOpened(false);
    document.addEventListener('keydown', clear, { once: true });
    return () => document.removeEventListener('keydown', clear);
  }, [pointerOpened]);

  const select = (item: HubPetal) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    closeAndReturnFocus();
    item.onSelect();
  };

  const keyWidth = (geo?.compact ? HUB_KEY_COMPACT : HUB_KEY).width;
  const disc = geo ? (geo.radius + keyWidth / 2 + DISC_PAD) * 2 : 0;

  return (
    <>
      <div className="board-hub-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        className={`board-hub-ring${geo?.compact ? ' is-compact' : ''}${
          pointerOpened ? ' board-hub-ring-pointer-opened' : ''
        }`}
        role="menu"
        aria-label="Board menu"
      >
        {geo && (
          <span
            className="board-hub-disc"
            aria-hidden="true"
            style={{ left: geo.hub.x, top: geo.hub.y, width: disc, height: disc }}
          />
        )}
        {geo?.onCircle && (
          <span
            className="board-hub-track"
            aria-hidden="true"
            style={{
              left: geo.hub.x,
              top: geo.hub.y,
              width: geo.radius * 2,
              height: geo.radius * 2,
            }}
          />
        )}
        {petals.map((petal, i) => {
          const pos = geo?.points[i];
          return (
            <button
              key={petal.id}
              type="button"
              role="menuitem"
              className={`board-hub-key${petal.primary ? ' is-primary' : ''}`}
              style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { opacity: 0 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={select(petal)}
            >
              {petal.icon}
              <span className="board-hub-key-label">{petal.label}</span>
            </button>
          );
        })}
        {dock.length > 0 && (
          <div ref={dockRef} className="board-hub-dock" role="none">
            {dock.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="board-hub-dock-item"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={select(item)}
              >
                {item.icon}
                <span className="board-hub-dock-label">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
