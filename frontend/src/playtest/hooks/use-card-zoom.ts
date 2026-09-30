import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clampZoom, readZoom, WHEEL_STEP_PX, writeZoom, ZOOM_STEP } from '../lib/board-support';

/**
 * The table's card size: a multiplier on the tier's card box (density-driven
 * at the desk, thumb-sized below 1024px), persisted per device and applied on
 * <body> (where `--pt-card-w` lives so the drag overlay inherits it). 1 is
 * the size the tier computes. Owns the two gestures that set it: ctrl + wheel
 * (wide tier) and a two-finger pinch on the table (every width).
 */
export function useCardZoom(battlefieldRef: RefObject<HTMLElement | null>, isNarrow: boolean) {
  const [zoom, setZoom] = useState(() => readZoom());
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
    document.body.style.setProperty('--pt-zoom', String(zoom));
    return () => {
      document.body.style.removeProperty('--pt-zoom');
    };
  }, [zoom]);
  const stepZoom = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const next = clampZoom(z + dir * ZOOM_STEP);
      writeZoom(next);
      return next;
    });
  }, []);
  const setZoomTo = useCallback((z: number) => {
    const next = clampZoom(z);
    writeZoom(next);
    setZoom(next);
  }, []);
  // EDHPlay's gesture: ctrl and the wheel size the cards, and the page itself
  // never zooms under the table (the felt, its grid and the chrome stay put).
  // A trackpad pinch reaches the browser as the same ctrl + wheel, so it
  // sizes the cards too. Native and non-passive, because React's onWheel is
  // passive and cannot stop the browser's own zoom. Only on the wide tier,
  // the one with a card size to set (see TableSettingsSheet); a narrow
  // window keeps the browser's zoom.
  useEffect(() => {
    if (isNarrow) return;
    // One step per mouse-wheel notch (~100px in Chromium, 3 lines in
    // Firefox), and a pinch's many small deltas add up to the same.
    let pending = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      // A change of direction starts over, so reversing answers at once.
      if (Math.sign(dy) !== Math.sign(pending)) pending = 0;
      pending += dy;
      while (Math.abs(pending) >= WHEEL_STEP_PX) {
        const dir = pending < 0 ? 1 : -1;
        stepZoom(dir);
        pending += dir * WHEEL_STEP_PX;
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [isNarrow, stepZoom]);
  // The same gesture on a touch screen, at every width: two fingers anywhere
  // on the table (felt, cards, hand) pinch the card size, which follows the
  // fingers in 0.1 steps and is saved once, when the last finger lifts. The
  // table's `touch-action` keeps the page itself from zooming under it.
  useEffect(() => {
    let pinch: { span: number; from: number; to: number } | null = null;
    const span = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (pinch || e.touches.length !== 2) return;
      if (!battlefieldRef.current?.contains(e.target as Node)) return;
      // The first finger may be a card drag, pending or already moving. The
      // pointer sensor listens for this on the document and drops the card
      // back where it was. Touch events follow their pointer events, so the
      // second finger's own pointerdown has already come and gone.
      document.dispatchEvent(new PointerEvent('pointercancel'));
      pinch = { span: span(e.touches) || 1, from: zoomRef.current, to: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const next = clampZoom((pinch.from * span(e.touches)) / pinch.span);
      if (next === pinch.to) return;
      pinch.to = next;
      setZoom(next);
    };
    const onEnd = (e: TouchEvent) => {
      if (!pinch) return;
      // Neither lifting finger is a tap: no ping, no preview.
      if (e.cancelable) e.preventDefault();
      if (e.touches.length > 0) return;
      setZoomTo(pinch.to);
      pinch = null;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onEnd, { passive: false });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [setZoomTo, battlefieldRef]);
  return { zoom, stepZoom, setZoomTo };
}
