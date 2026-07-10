import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import './RadialTagMenu.css';
import { DECK_CARD_TAGS, sectorForPoint } from '@/lib/deck-card-tags';

export interface RadialTagMenuProps {
  /** Viewport point (e.g. the opening pointerdown's clientX/Y) to center on. */
  anchor: { x: number; y: number };
  /** Tags currently on the slot — rendered filled with aria-checked. */
  activeTags: string[];
  /** Toggle a tag on the slot. The menu itself decides whether to close. */
  onToggle: (tag: string) => void;
  /** Close the menu. The caller owns returning focus to its trigger. */
  onClose: () => void;
}

const SECTOR_COUNT = DECK_CARD_TAGS.length;
/** Distance from center to each sector chip's center. */
const RING_RADIUS = 84;
/**
 * Center dead zone of the sector hit-test, and the swipe threshold: the
 * opening press must travel this far from the press point before its release
 * commits a sector. Release before that parks the menu open (click mode).
 */
const DEAD_ZONE_RADIUS = 24;
/** Half-extent of the ring incl. the widest chip — for viewport clamping. */
const CLAMP_X = RING_RADIUS + 56;
const CLAMP_Y = RING_RADIUS + 32;

function clampedCenter(anchor: { x: number; y: number }): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  return {
    x: clamp(anchor.x, CLAMP_X, Math.max(CLAMP_X, window.innerWidth - CLAMP_X)),
    y: clamp(anchor.y, CLAMP_Y, Math.max(CLAMP_Y, window.innerHeight - CLAMP_Y)),
  };
}

/**
 * Radial quick-pick for per-card functional tags: the 8 palette tags arranged
 * in a circle around the opening point. Two interaction modes in one gesture:
 *
 * - Swipe: the opening pointerdown is still held AND has traveled past the
 *   dead-zone radius from the press point → pointermove highlights the sector
 *   under the pointer (angle-only via sectorForPoint, relative to the ring
 *   center, so targets are generous) and release toggles it and closes.
 *   Dragging back into the ring's center dead zone cancels the commit.
 * - Click: a plain tap (never left the dead zone around the press point)
 *   parks the menu open; clicking sectors then toggles them without closing
 *   (apply several in one visit); clicking outside or Escape closes.
 *
 * Swipe intent is measured from the PRESS POINT, not the ring center: near a
 * viewport edge the center clamps on-screen, up to ~100px away from the
 * finger — measured from the center, a motionless tap read as a swipe-commit
 * on whichever sector faced the press point (it silently toggled Interaction
 * from the right edge, where every row's tag button lives).
 *
 * Keyboard: arrows move a roving highlight around the circle, Enter/Space
 * toggles it, Escape closes. Items are role=menuitemcheckbox with aria-checked.
 */
export function RadialTagMenu({
  anchor,
  activeTags,
  onToggle,
  onClose,
}: RadialTagMenuProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hotSector, setHotSector] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  // Mirror for the window keydown listener (state would go stale in it).
  const focusIndexRef = useRef(0);
  const moveFocus = (i: number): void => {
    focusIndexRef.current = i;
    setFocusIndex(i);
  };
  // 'drag' while the opening press may still be held; 'click' once it has
  // released in the dead zone (or a fresh press proves the gesture is over).
  const gestureRef = useRef<'drag' | 'click'>('drag');
  // True once the opening press has left the dead zone around the press
  // point — only then does its release commit a sector.
  const swipedRef = useRef(false);
  // The unclamped press point; `center` below may clamp away from it.
  const pressRef = useRef(anchor);
  // True right after the opening press releases: the browser synthesizes a
  // click at the release point, and the edge-clamped ring can mount a chip
  // exactly there — that echo click toggled a tag the user never chose. A
  // deliberate chip click always starts with its own fresh pointerdown
  // (which clears this), so a flagged click is an echo to ignore.
  const ghostClickRef = useRef(false);

  // Latest-callback refs so the window listeners never go stale (the caller
  // passes inline arrows).
  const onToggleRef = useRef(onToggle);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onToggleRef.current = onToggle;
    onCloseRef.current = onClose;
  }, [onToggle, onClose]);

  // Anchor is fixed for the menu's lifetime (a new open is a new mount — the
  // host keys the element), so clamp once; the listeners close over it safely.
  const [center] = useState(() => clampedCenter(anchor));

  // Move focus into the menu so keyboard interaction works immediately.
  useEffect(() => {
    itemRefs.current[0]?.focus({ preventScroll: true });
  }, []);

  // Gesture + dismissal tracking. Window-level: the opening pointerdown
  // happened on the trigger before this mounted, so the press's move/up
  // events are only observable from here.
  useEffect(() => {
    const sectorAt = (e: PointerEvent): number | null =>
      sectorForPoint(e.clientX - center.x, e.clientY - center.y, SECTOR_COUNT, DEAD_ZONE_RADIUS);

    const onPointerMove = (e: PointerEvent): void => {
      if (gestureRef.current !== 'drag') return;
      // buttons === 0 → the opening press already ended (we missed the up,
      // e.g. it happened before mount finished) — stop treating moves as drag.
      if (e.buttons === 0) return;
      // Not a swipe until the pointer leaves the dead zone around the PRESS
      // POINT — tap micro-jitter must not arm a commit (the clamped center
      // can sit far from the finger, where jitter is instantly "in a sector").
      if (!swipedRef.current) {
        const p = pressRef.current;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DEAD_ZONE_RADIUS) return;
        swipedRef.current = true;
      }
      setHotSector(sectorAt(e));
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (gestureRef.current !== 'drag') return;
      gestureRef.current = 'click';
      setHotSector(null);
      // This release will echo as a synthesized click — see ghostClickRef.
      ghostClickRef.current = true;
      // A plain tap (never armed the swipe): park open in click mode.
      if (!swipedRef.current) return;
      const sector = sectorAt(e);
      if (sector !== null) {
        onToggleRef.current(DECK_CARD_TAGS[sector]);
        onCloseRef.current();
      }
      // Swiped back into the ring's center dead zone: park open instead.
    };

    const onPointerDown = (e: PointerEvent): void => {
      // A fresh press means any click that follows is deliberate.
      ghostClickRef.current = false;
      if (gestureRef.current === 'drag') {
        // A fresh press while we still assumed the opening one was live means
        // the menu was opened without a pointer (keyboard) — its release must
        // not swipe-commit.
        gestureRef.current = 'click';
        setHotSector(null);
      }
      const target = e.target as Node;
      if (!panelRef.current?.contains(target)) onCloseRef.current();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [center]);

  // Keyboard: roving highlight + toggle + dismiss. Enter/Space are handled
  // here (with preventDefault suppressing the button's native click) so a
  // toggle can't double-fire, and the menu stays open for more toggles.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      const dir =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (dir !== 0) {
        e.preventDefault();
        gestureRef.current = 'click';
        const next = (focusIndexRef.current + dir + SECTOR_COUNT) % SECTOR_COUNT;
        focusIndexRef.current = next;
        setFocusIndex(next);
        itemRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleRef.current(DECK_CARD_TAGS[focusIndexRef.current]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Scroll/resize staleness: the ring is fixed-position over a row that just
  // moved (or a viewport that just changed) under it — dismiss, mirroring the
  // hover-peek's rule. Capture-phase catches inner scroll containers too. The
  // opening press can't trip this: the trigger and chips are touch-action:
  // none, so the gesture never scrolls.
  useEffect(() => {
    const dismiss = (): void => onCloseRef.current();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  return createPortal(
    <div ref={panelRef} className="radial-tag-menu" role="menu" aria-label="Card tags">
      <span
        className="radial-tag-menu-center"
        aria-hidden
        style={{ left: center.x, top: center.y }}
      >
        Tag
      </span>
      {DECK_CARD_TAGS.map((tag, i) => {
        // Sector 0 centered at 12 o'clock, clockwise — matches sectorForPoint.
        const angle = (i / SECTOR_COUNT) * 2 * Math.PI - Math.PI / 2;
        const x = center.x + RING_RADIUS * Math.cos(angle);
        const y = center.y + RING_RADIUS * Math.sin(angle);
        const active = activeTags.includes(tag);
        return (
          <button
            key={tag}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitemcheckbox"
            aria-checked={active}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`radial-tag-menu-item${active ? ' is-active' : ''}${
              hotSector === i ? ' is-hot' : ''
            }`}
            style={{ left: x, top: y }}
            onFocus={() => moveFocus(i)}
            onClick={(e) => {
              // Click mode: toggle and stay open so several tags can be
              // applied in one visit. stopPropagation keeps the click off
              // whatever sits under the portal.
              e.stopPropagation();
              // The opening tap's echo click (no fresh pointerdown before
              // it) can land on the chip the clamped ring mounted under the
              // finger — ignore it; only deliberate clicks toggle.
              if (ghostClickRef.current) {
                ghostClickRef.current = false;
                return;
              }
              onToggle(tag);
            }}
          >
            {tag}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
