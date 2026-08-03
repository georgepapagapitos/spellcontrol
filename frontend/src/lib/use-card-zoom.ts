import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Tunables. */
const MAX_SCALE = 4;
const MIN_SCALE = 1;
/** Release below this and the gesture reads as "done zooming" → snap out. */
const EXIT_SCALE = 1.05;
/** Scale the Zoom button jumps to. Past ~2.5 the `large` (672w) art visibly softens. */
const BUTTON_SCALE = 2.5;
/** Movement under this still counts as a tap, not a pan. */
const TAP_SLOP_PX = 10;
/** Pinch has to actually open before we commit to zoom mode. */
const ENTER_SCALE = 1.02;

interface Options {
  /**
   * The sheet. Listeners bind here in the CAPTURE phase, not on the zoom layer:
   * the pinch that *enters* zoom lands while the layer is still
   * `pointer-events: none`, and touch events stay bound to the element that saw
   * `touchstart` for the life of the gesture. Capturing at the sheet means one
   * listener set covers both the entering pinch and everything after it.
   */
  sheetRef: RefObject<HTMLElement | null>;
  /** The zoom layer — supplies the viewport the image is clamped against. */
  layerRef: RefObject<HTMLElement | null>;
  /** The zoomed `<img>`. The hook writes `transform` straight to this node. */
  imgRef: RefObject<HTMLElement | null>;
  /**
   * Rotation (deg) of the card being zoomed, for sideways layouts. Read as a
   * getter so the hook composes the full transform string itself — writing
   * scale/translate and rotation from two places would have them clobber
   * each other on every frame.
   */
  getTurn?: () => number;
  /** False when there's nothing zoomable (image errored / still loading). */
  enabled?: boolean;
}

interface Result {
  /**
   * True once the pinch commits. Drives the layer's visibility and the
   * fade-out of the panel + flip row. Flips twice per gesture, never per
   * frame — the transform itself never goes through React.
   */
  zoomed: boolean;
  /** Programmatic exit (Escape, card change, flip). Safe to call when not zoomed. */
  exitZoom: () => void;
  /**
   * Jump straight to a readable zoom. Wired to the flip-row's Zoom button —
   * pinch is invisible and touch-only, so this is the discoverable entry
   * point, and the only one available to a mouse or keyboard.
   */
  zoomIn: () => void;
}

const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a: Touch, b: Touch) => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
});

/**
 * Pinch-to-zoom + pan for the card preview's zoom layer.
 *
 * The carousel sheet already has three gesture owners — the track's horizontal
 * scroll-snap (`touch-action: pan-x`), the info panel's vertical scroll
 * (`pan-y`), and the JS swipe-down-to-dismiss. Rather than arbitrate a fourth
 * against all three, a committed pinch *lifts the card out* into a dedicated
 * full-sheet layer that owns its touches outright (`touch-action: none`), and
 * the chrome underneath fades away. That's also the interaction users expect:
 * zoom in, the surrounding UI gets out of the way.
 *
 * While a zoom gesture is live the hook calls `stopPropagation()` during
 * capture, so `useSwipeDownDismiss`'s React handlers (bound at the root, on
 * bubble) never see the touch and can't drag the sheet out from under a pan.
 *
 * Gestures: two-finger pinch to enter/scale, one-finger drag to pan while
 * zoomed, tap to exit. Releasing a pinch below `EXIT_SCALE` snaps out. The
 * Zoom button (`zoomIn`) is the non-touch / discoverable entry.
 */
export function useCardZoom({
  sheetRef,
  layerRef,
  imgRef,
  getTurn,
  enabled = true,
}: Options): Result {
  const [zoomed, setZoomed] = useState(false);

  // Live transform. Refs, not state — this is written per frame.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  // Natural on-screen size of the image at scale 1, captured on zoom entry.
  // getBoundingClientRect gives the axis-aligned box, so a 90°-turned card
  // reports its swapped width/height for free — no special-casing rotation.
  const baseRef = useRef({ w: 0, h: 0 });
  // Gesture bases.
  const pinchRef = useRef<{
    d: number;
    x: number;
    y: number;
    s: number;
    tx: number;
    ty: number;
  } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const tapRef = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  // Mirrors `zoomed` for the event handlers, which are bound once and would
  // otherwise close over a stale value.
  const zoomedRef = useRef(false);

  const write = useCallback(
    (animate: boolean) => {
      const img = imgRef.current;
      if (!img) return;
      img.style.transition = animate ? 'transform 220ms var(--ease-out-soft, ease-out)' : 'none';
      img.style.transform =
        `translate3d(${txRef.current}px, ${tyRef.current}px, 0) ` +
        `scale(${scaleRef.current}) rotate(${getTurn?.() ?? 0}deg)`;
    },
    [imgRef, getTurn]
  );

  /** Keep the image's edges from pulling inside the layer — no dead space. */
  const clampPan = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const { width, height } = layer.getBoundingClientRect();
    const maxX = Math.max(0, (baseRef.current.w * scaleRef.current - width) / 2);
    const maxY = Math.max(0, (baseRef.current.h * scaleRef.current - height) / 2);
    txRef.current = Math.min(maxX, Math.max(-maxX, txRef.current));
    tyRef.current = Math.min(maxY, Math.max(-maxY, tyRef.current));
  }, [layerRef]);

  const exitZoom = useCallback(() => {
    if (!zoomedRef.current) return;
    zoomedRef.current = false;
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    pinchRef.current = null;
    panRef.current = null;
    write(true);
    setZoomed(false);
  }, [write]);

  const enterZoom = useCallback(() => {
    if (zoomedRef.current) return;
    const img = imgRef.current;
    if (img) {
      // Measured at scale 1, before the layer becomes visible — the image is
      // laid out either way (the layer is `visibility: hidden`, not `display:
      // none`, precisely so this measurement is available).
      const r = img.getBoundingClientRect();
      baseRef.current = { w: r.width, h: r.height };
    }
    zoomedRef.current = true;
    setZoomed(true);
  }, [imgRef]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !enabled) return;

    /**
     * Never swallow a touch aimed at a control. The hook captures on the
     * sheet, so without this a single-finger tap on the close/flip/Zoom
     * buttons while zoomed would be preventDefault'd into nothing.
     */
    const onControl = (e: TouchEvent) =>
      e.target instanceof Element && e.target.closest('button, a, input, select, textarea');

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && onControl(e)) return;
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const m = mid(a, b);
        pinchRef.current = {
          d: dist(a, b) || 1,
          x: m.x,
          y: m.y,
          s: scaleRef.current,
          tx: txRef.current,
          ty: tyRef.current,
        };
        panRef.current = null;
        tapRef.current = null;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        tapRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
        if (zoomedRef.current) {
          panRef.current = { x: t.clientX, y: t.clientY, tx: txRef.current, ty: tyRef.current };
          e.stopPropagation();
          e.preventDefault();
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (pinch && e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (dist(a, b) / pinch.d) * pinch.s));
        if (!zoomedRef.current && next > ENTER_SCALE) enterZoom();
        scaleRef.current = next;
        // Track the midpoint so the card follows two fingers moving together,
        // and keep the pinch anchored where the fingers actually are.
        const m = mid(a, b);
        txRef.current = pinch.tx + (m.x - pinch.x);
        tyRef.current = pinch.ty + (m.y - pinch.y);
        if (zoomedRef.current) clampPan();
        write(false);
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const tap = tapRef.current;
      if (tap && !tap.moved) {
        const t = e.touches[0];
        if (t && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
      }
      const pan = panRef.current;
      if (pan && zoomedRef.current && e.touches.length === 1) {
        const t = e.touches[0];
        txRef.current = pan.tx + (t.clientX - pan.x);
        tyRef.current = pan.ty + (t.clientY - pan.y);
        clampPan();
        write(false);
        e.stopPropagation();
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const wasPinching = pinchRef.current !== null;
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length === 0) panRef.current = null;

      const tap = tapRef.current;
      tapRef.current = null;
      // A clean tap while zoomed exits. Tap handling is gated to zoom mode —
      // unzoomed taps belong to the carousel (tap-to-close, tap-a-neighbour-
      // to-advance). preventDefault here so the exiting tap doesn't also
      // synthesize a click onto whatever is revealed underneath.
      if (zoomedRef.current && tap && !tap.moved && !wasPinching && e.touches.length === 0) {
        exitZoom();
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      if (wasPinching && e.touches.length === 0) {
        if (scaleRef.current <= EXIT_SCALE) {
          exitZoom();
        } else {
          clampPan();
          write(true);
        }
        e.stopPropagation();
      }
    };

    // Capture phase + non-passive: capture so a live zoom gesture is stopped
    // before React's root-level bubble dispatch reaches useSwipeDownDismiss;
    // non-passive so preventDefault can actually suppress native scroll.
    const opts = { capture: true, passive: false } as const;
    sheet.addEventListener('touchstart', onTouchStart, opts);
    sheet.addEventListener('touchmove', onTouchMove, opts);
    sheet.addEventListener('touchend', onTouchEnd, opts);
    sheet.addEventListener('touchcancel', onTouchEnd, opts);
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart, opts);
      sheet.removeEventListener('touchmove', onTouchMove, opts);
      sheet.removeEventListener('touchend', onTouchEnd, opts);
      sheet.removeEventListener('touchcancel', onTouchEnd, opts);
    };
  }, [sheetRef, enabled, enterZoom, exitZoom, clampPan, write]);

  const zoomIn = useCallback(() => {
    enterZoom();
    scaleRef.current = BUTTON_SCALE;
    txRef.current = 0;
    tyRef.current = 0;
    write(true);
  }, [enterZoom, write]);

  return { zoomed, exitZoom, zoomIn };
}
