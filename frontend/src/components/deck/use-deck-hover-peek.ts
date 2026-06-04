import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  computePeekPlacement,
  computePointerPlacement,
  peekWidth,
  rowGutterFits,
} from '@/lib/hover-peek-placement';
import { HOVER_HIDE_DELAY_MS, HOVER_INTENT_DELAY_MS, isPeekSuppressed } from '@/lib/hover-intent';
import { useHoverCapable } from '@/lib/use-hover-capable';

// MTG card aspect ratio (Scryfall normal is 488×680) — derives the peek height
// from its (viewport-responsive) width for the vertical centering/clamping math.
const CARD_ASPECT = 680 / 488;
// Default min viewport for the gutter ('row') anchor: below this there's no
// gutter to host the peek beside a row, so it would overlap the list. The
// default cursor ('pointer') anchor needs no gutter, so it activates at any width.

/**
 * Hover-peek is a **desktop (≥1024px) affordance** per STYLE_GUIDE ("hover-peek
 * `≥1024`"). Below it, the deck surfaces are cramped enough that a floating peek
 * (gutter-locked or cursor-following) reads as noise — tablet/mobile use
 * tap→carousel instead. Pass this as `minViewport` on every peek caller so the
 * feature simply doesn't activate under desktop width. (Capability-gating still
 * applies on top — a fine pointer is also required.)
 */
export const HOVER_PEEK_MIN_VIEWPORT = 1024;

export interface HoverPeekOptions {
  /** Smallest viewport width (px) at which the peek activates. Default 0 — the
   *  cursor anchor needs no gutter. Pass a floor (e.g. 1024) only for the legacy
   *  gutter anchor, which needs the room. */
  minViewport?: number;
  /** 'pointer' (default) floats the peek beside the cursor — works in a centered
   *  panel or a list, at any width, and is the unified behavior across surfaces.
   *  'row' pins it in the gutter beside the hovered row (needs `minViewport`). */
  anchor?: 'row' | 'pointer';
}

export interface HoverPeekState {
  name: string;
  left: number;
  top: number;
  /** Viewport-responsive px width; the component sets it inline so the CSS box
   *  matches the size the placement math used. */
  width: number;
}

/**
 * Hover-peek shared by the deck list and the Tune Improve lane: hovering a
 * `[data-peek-name]` element floats the full card art beside the cursor so a card
 * can be inspected without leaving the surface or opening the full-screen sheet.
 * Cursor-anchored by default (works in a list or a centered panel, at any
 * viewport width); a legacy `anchor: 'row'` gutter mode remains for callers that
 * have the room. Capability-gated to `(hover: hover) and (pointer: fine)`, so
 * touch / mobile / native never trigger it — those keep the tap→sheet flow.
 * Shows after a short dwell and tears down after a short grace once the pointer
 * leaves a tracked element (or the container), so brief exits don't flicker.
 * Returns the active peek plus delegated handlers to spread on the container
 * (one `data-peek-name` attribute per hoverable element is all the markup it needs).
 */
export function useDeckHoverPeek({ minViewport = 0, anchor = 'pointer' }: HoverPeekOptions = {}) {
  const [peek, setPeek] = useState<HoverPeekState | null>(null);
  // Mirror in a ref (synced via effect, never written during render) so the
  // stable handlers can dedupe against the current peek without re-subscribing.
  const peekRef = useRef<HoverPeekState | null>(null);
  useEffect(() => {
    peekRef.current = peek;
  }, [peek]);
  // Capability gate (shared, reactive): a fine-hover pointer only. Mirror into a
  // ref so the event handlers read the current value without re-subscribing, and
  // tear any peek down the instant capability is lost (a mouse unplugged).
  const capable = useHoverCapable();
  const capableRef = useRef(capable);

  // Two timers drive this surface: a show dwell (HOVER_INTENT_DELAY_MS) so a peek
  // appears only on a deliberate pause, and a hide grace (HOVER_HIDE_DELAY_MS) so
  // a brief exit — a gap between rows, a clipped corner — doesn't tear it down.
  // `pendingNameRef` lets repeated mouseover events on the same card leave the
  // running show timer alone instead of restarting it forever.
  const timerRef = useRef<number | null>(null);
  const pendingNameRef = useRef<string | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingNameRef.current = null;
  }, []);
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const clear = useCallback(() => {
    cancelPending();
    cancelHide();
    setPeek(null);
  }, [cancelPending, cancelHide]);
  // Leaving a tracked element starts the hide grace instead of tearing the peek
  // down at once; a re-entry within the window cancels it (see onMouseOver). Also
  // cancels a pending show — once the pointer has left, no queued peek should fire.
  const scheduleHide = useCallback(() => {
    cancelPending();
    if (hideTimerRef.current !== null) return; // already counting down
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setPeek(null);
    }, HOVER_HIDE_DELAY_MS);
  }, [cancelPending]);

  // Sync the capability flag into a ref for the event handlers (never written
  // during render).
  useEffect(() => {
    capableRef.current = capable;
  }, [capable]);
  // When a fine pointer is lost (mouse unplugged, convertible folded to tablet),
  // drop the peek. Done as an adjust-state-during-render (React's documented
  // pattern for resetting state on an input change) rather than in an effect, so
  // there's no set-state-in-effect; the timers are cleared in the effect below.
  const [prevCapable, setPrevCapable] = useState(capable);
  if (capable !== prevCapable) {
    setPrevCapable(capable);
    if (!capable) setPeek(null);
  }
  useEffect(() => {
    if (!capable) {
      cancelPending();
      cancelHide();
    }
  }, [capable, cancelPending, cancelHide]);

  // Any scroll or resize staleness-invalidates a peek's anchor (the row moved) or
  // size (responsive width) — and would mis-place a still-pending one — so tear
  // everything down. Attached whenever a fine-hover pointer is present (a dwell
  // can be in flight before any peek exists), but NOT on touch/coarse, where no
  // peek can ever show — that keeps the mobile scroll hot path listener-free.
  // Capture-phase to catch scrolls on inner scroll containers too.
  useEffect(() => {
    if (!capable) return;
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    return () => {
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('resize', clear);
    };
  }, [capable, clear]);

  // Belt-and-suspenders: never leave a timer running past unmount.
  useEffect(
    () => () => {
      cancelPending();
      cancelHide();
    },
    [cancelPending, cancelHide]
  );

  const onMouseOver = useCallback(
    (e: MouseEvent) => {
      if (!capableRef.current) return;
      const vw = window.innerWidth;
      if (vw < minViewport) return; // gutter anchor needs the room; pointer passes 0
      // Hovering (or aiming at) an action zone — the row's kebab/menu — must
      // never raise the peek, and tears down one already up or pending at once
      // (no grace: the pointer is on a control, get out of the way now).
      if (isPeekSuppressed(e.target)) {
        clear();
        return;
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-peek-name]');
      if (!el) {
        // Left the thumbnail onto the row body or a gap. Pointer anchor starts the
        // hide grace (a quick re-entry cancels it); row anchor persists to avoid
        // row-to-row flicker and only tears down on container leave.
        if (anchor === 'pointer') scheduleHide();
        return;
      }
      const name = el.dataset.peekName;
      if (!name) return;
      // Over a tracked target → cancel any pending teardown (grace re-entry).
      cancelHide();
      // Already showing this card, or already waiting to — let the dwell run.
      if (name === peekRef.current?.name || name === pendingNameRef.current) return;

      // New target → crisp switch. Capture the entry pointer/row geometry now; the
      // dwell pins the peek where the cursor came to rest. Dropping the old peek at
      // once (the name differs, so this is a real move) means moving across rows
      // shows nothing until the cursor rests, not a stale card by the old anchor.
      const clientX = e.clientX;
      const clientY = e.clientY;
      const rect = el.getBoundingClientRect();
      clear();
      pendingNameRef.current = name;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        pendingNameRef.current = null;
        const w = peekWidth(window.innerWidth);
        const height = Math.round(w * CARD_ASPECT);
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        // Gutter lock only when a card actually fits beside the row; on a narrow
        // window (full-width rows, no spare gutter) fall back to the cursor
        // placement so the peek floats clear instead of clamping over the list.
        const useRowGutter = anchor === 'row' && rowGutterFits(rect, viewport, w);
        const { left, top } = useRowGutter
          ? computePeekPlacement(rect, viewport, w, height)
          : computePointerPlacement(clientX, clientY, viewport, w, height);
        setPeek({ name, left, top, width: w });
      }, HOVER_INTENT_DELAY_MS);
    },
    [minViewport, anchor, clear, cancelHide, scheduleHide]
  );

  const onMouseLeave = useCallback(() => scheduleHide(), [scheduleHide]);

  return { peek, clear, listHandlers: { onMouseOver, onMouseLeave } };
}
