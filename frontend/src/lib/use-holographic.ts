import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a holographic foil effect by tracking the cursor over a target element
 * and writing CSS custom properties (--rx, --ry, --mx, --my, --hyp) directly to
 * the DOM. CSS picks these up to animate tilt, glare position, and shimmer.
 *
 * Uses requestAnimationFrame for smoothing and bypasses React entirely on hover —
 * mousemove fires often enough that going through setState would tank framerate.
 *
 * Returns a callback ref so listeners re-bind whenever the target element changes
 * (e.g. carousel swaps which slide is active).
 */
interface HolographicOptions {
  /** Optional getter that returns true when tilt should be suppressed (e.g. during
   *  a touch swipe gesture handled by a parent). When true, glare/shimmer still
   *  track the cursor but rotateX/rotateY are pinned to 0 so the card doesn't
   *  fight the swipe visually. */
  shouldSuppressTilt?: () => boolean;
}

export function useHolographic(enabled: boolean, options: HolographicOptions = {}) {
  // Stash in a ref so the effect doesn't have to re-bind listeners every render
  // when the caller passes a fresh function.
  const suppressRef = useRef(options.shouldSuppressTilt);
  suppressRef.current = options.shouldSuppressTilt;

  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el || !enabled) return;

    let rafId: number | null = null;
    // Targets are what mousemove writes; current is what we lerp toward them.
    // gx/gy are normalized cursor offset in [-1, 1] — used by CSS for tilt-aware
    // shadow direction and inner-bevel highlight, where percentages can't be
    // multiplied into px values directly.
    // act is 0..1 — 1 while the cursor is on the card, lerps to 0 on leave.
    // CSS reads it as --active and uses it to gate the foil overlay opacity
    // so foil only appears during interaction (matches simey/pokemon-cards
    // approach of opacity = card-opacity).
    const target = { rx: 0, ry: 0, mx: 50, my: 50, hyp: 0, gx: 0, gy: 0, act: 0 };
    const current = { rx: 0, ry: 0, mx: 50, my: 50, hyp: 0, gx: 0, gy: 0, act: 0 };
    let active = false;

    const apply = () => {
      // Lerp current → target. Higher factor = snappier. While the cursor is
      // active we want it tracking tightly; on leave we ease back gently.
      const k = active ? 0.28 : 0.1;
      current.rx += (target.rx - current.rx) * k;
      current.ry += (target.ry - current.ry) * k;
      current.mx += (target.mx - current.mx) * k;
      current.my += (target.my - current.my) * k;
      current.hyp += (target.hyp - current.hyp) * k;
      current.gx += (target.gx - current.gx) * k;
      current.gy += (target.gy - current.gy) * k;
      current.act += (target.act - current.act) * k;

      el.style.setProperty('--rx', `${current.rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${current.ry.toFixed(2)}deg`);
      el.style.setProperty('--mx', `${current.mx.toFixed(2)}%`);
      el.style.setProperty('--my', `${current.my.toFixed(2)}%`);
      el.style.setProperty('--hyp', current.hyp.toFixed(3));
      el.style.setProperty('--gx', current.gx.toFixed(3));
      el.style.setProperty('--gy', current.gy.toFixed(3));
      el.style.setProperty('--active', current.act.toFixed(3));

      // Stop the loop when we've settled close to neutral.
      const settled =
        Math.abs(current.rx - target.rx) < 0.05 &&
        Math.abs(current.ry - target.ry) < 0.05 &&
        Math.abs(current.mx - target.mx) < 0.1 &&
        Math.abs(current.my - target.my) < 0.1;
      if (settled && !active) {
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(apply);
    };

    const ensureLoop = () => {
      if (rafId == null) rafId = requestAnimationFrame(apply);
    };

    const onMove = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width; // 0..1
      const y = (clientY - rect.top) / rect.height;
      // Clamp to viewport in case of subpixel overshoot.
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      // Tilt range: ±18° matches the codepen reference — strong enough to read
      // as a real tilt without going past the card's plausible motion arc.
      // Suppressed during parent-owned swipe gestures so the tilt doesn't fight
      // the navigation/dismiss flick.
      const suppressed = suppressRef.current?.() === true;
      target.ry = suppressed ? 0 : (cx - 0.5) * 36;
      target.rx = suppressed ? 0 : (0.5 - cy) * 36;
      target.mx = cx * 100;
      target.my = cy * 100;
      // Hypotenuse: 0 at center, 1 at corner — used to crank up shimmer near edges.
      const dx = cx - 0.5;
      const dy = cy - 0.5;
      target.hyp = Math.min(1, Math.hypot(dx, dy) * 2);
      // Normalized -1..1 offsets for shadow/bevel direction in CSS.
      target.gx = (cx - 0.5) * 2;
      target.gy = (cy - 0.5) * 2;
      target.act = 1;
      active = true;
      ensureLoop();
    };

    const reset = () => {
      target.rx = 0;
      target.ry = 0;
      target.mx = 50;
      target.my = 50;
      target.hyp = 0;
      target.gx = 0;
      target.gy = 0;
      target.act = 0;
      active = false;
      ensureLoop();
    };

    // Touch-only devices get a tap-to-peek interaction instead of continuous
    // tracking — continuous touchmove would fight the carousel's swipe-to-
    // navigate and swipe-to-dismiss gestures. A tap (touch that lifts within
    // 8px of where it landed, matching the carousel's axis-lock threshold)
    // tilts the card toward the tap point and eases back after a moment.
    const isTouchOnly = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);

    let tapStart: { x: number; y: number } | null = null;
    let resetTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const TAP_MOVE_THRESHOLD_PX = 8;
    const TAP_HOLD_MS = 700;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      tapStart = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      const start = tapStart;
      tapStart = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      // If the finger moved more than the threshold, it was a swipe — let
      // the carousel handle it and don't peek.
      if (
        Math.abs(t.clientX - start.x) > TAP_MOVE_THRESHOLD_PX ||
        Math.abs(t.clientY - start.y) > TAP_MOVE_THRESHOLD_PX
      ) {
        return;
      }
      onMove(start.x, start.y);
      if (resetTimeoutId != null) clearTimeout(resetTimeoutId);
      resetTimeoutId = setTimeout(reset, TAP_HOLD_MS);
    };
    const onTouchCancel = () => {
      tapStart = null;
    };

    if (isTouchOnly) {
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchend', onTouchEnd);
      el.addEventListener('touchcancel', onTouchCancel);
    } else {
      el.addEventListener('mousemove', onMouseMove);
      el.addEventListener('mouseleave', reset);
    }

    return () => {
      if (isTouchOnly) {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchCancel);
      } else {
        el.removeEventListener('mousemove', onMouseMove);
        el.removeEventListener('mouseleave', reset);
      }
      if (resetTimeoutId != null) clearTimeout(resetTimeoutId);
      if (rafId != null) cancelAnimationFrame(rafId);
      // Clear vars so the slide returns to flat instantly on prop change.
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
      el.style.removeProperty('--hyp');
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gy');
      el.style.removeProperty('--active');
    };
  }, [el, enabled]);

  return ref;
}
